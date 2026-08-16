/**
 * Redaction, applied at the emitter.
 *
 * REPO_RULES §5 says records are structured; it does not say they are safe. Before this
 * module the only thing called "redaction" was `redactArgs` in the tool executor, which
 * elided strings over 500 characters and removed nothing sensitive — a 51-character API
 * key went to disk verbatim. The name asserted a control that did not exist.
 *
 * Why here and not at the reader: once a key reaches `audit.jsonl` it is in the file, in
 * whatever the user backs that directory up with, and in any bug report they paste. A
 * filter applied on read does not undo any of that. So every record passes through here
 * on its way to *every* sink, including the HATS_DEBUG stderr sink — a developer tailing
 * logs is still a place a secret can be read from.
 *
 * Two independent passes, because either alone leaks:
 *  - by key name: `{ apiKey: "short" }` is a secret whatever the value looks like.
 *  - by value shape: a token pasted into a `command` or `url` field has an innocent key.
 *
 * Deliberately not clever. A denylist that tries to understand the payload will be wrong
 * in the direction that costs the most, so anything matching is replaced outright rather
 * than partially masked. Where a value is needed to correlate rather than to read, it is
 * replaced by a short hash of itself: the same address produces the same tag across
 * records, and the address itself is not recoverable from the tag.
 */

import { createHash } from 'node:crypto';

/** Long values are still elided — volume was the original point and remains valid. */
const MAX_STRING = 500;
const MAX_DEPTH = 6;

/**
 * Field names the runtime deliberately emits and which must survive redaction, checked
 * before the denylist.
 *
 * This list exists because the obvious denylist is wrong. `token` as a substring matches
 * `inputTokens`, `outputTokens` and `cacheReadTokens` — the entire per-call cost record —
 * and a redactor that blanks the numbers it was built to protect is worse than none: the
 * telemetry looks present and reads as zero. Anything added here is a claim that the field
 * never holds a secret, so it is short and specific rather than a pattern.
 */
const SAFE_KEY = new Set(
  [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'maxTokens',
    'totalTokens',
    'tokens',
    'tokenCount',
    'authorityId',
    'author',
  ].map((k) => k.toLowerCase()),
);

/**
 * Key names whose value is sensitive regardless of shape. Matched as a substring so
 * `x-auth-token` and `apiKey` both hit, but each alternative is bounded so it does not
 * swallow an ordinary field: bare `auth` must not match `author`, `pin` must not match
 * `spinner`, and `token` must not match a plural count. `key` alone is never sensitive —
 * only the qualified forms are — because half the runtime's maps are keyed by `key`.
 */
const SENSITIVE_KEY = new RegExp(
  [
    'pass(word|wd|phrase)',
    'secret',
    'token(?!s)',
    'api[-_]?key',
    'access[-_]?key',
    'private[-_]?key',
    'secret[-_]?key',
    'credential',
    'authorization',
    'auth(?![a-z])',
    'cookie',
    'session[-_]?id',
    'bearer',
    'signature',
    'refresh[-_]?token',
    'otp(?![a-z])',
    'passcode',
    'pin(?![a-z])',
    'ssn(?![a-z])',
    'card[-_]?number',
    'cvv',
  ].join('|'),
  'i',
);

function sensitiveKey(key: string): boolean {
  if (SAFE_KEY.has(key.toLowerCase())) return false;
  return SENSITIVE_KEY.test(key);
}

/**
 * Value shapes that are secrets wherever they appear. Each is anchored tightly enough not
 * to fire on prose: the first version of this list matched `rule/ask-before-you-finish`
 * on a loose `sk-` pattern, which is exactly the false positive that teaches a team to
 * ignore the redactor. Provider prefixes therefore require a run of key-alphabet
 * characters with no hyphen, which no rule id has.
 */
const SECRET_VALUE: Array<{ kind: string; re: RegExp }> = [
  { kind: 'openai', re: /\bsk-(proj-)?[A-Za-z0-9]{20,}\b/g },
  { kind: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'github', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'google', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { kind: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'pem', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { kind: 'pem', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/g },
];

/** Personal data that is replaced by a stable tag rather than removed, so it still joins. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Query parameters that carry credentials in otherwise loggable URLs. */
const SENSITIVE_QUERY = /([?&](?:access_token|api_key|apikey|token|key|signature|sig|password|auth)=)([^&\s"]+)/gi;

/** Short, stable, one-way. Enough to correlate two records, not enough to recover a value. */
export function tag(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Redacts a single string. Order matters: PEM blocks and bearer headers are matched before
 * the generic patterns so the longer match wins and no fragment survives.
 */
export function redactString(input: string): string {
  let out = input;
  for (const { kind, re } of SECRET_VALUE) {
    out = out.replace(re, () => `[redacted:${kind}]`);
  }
  out = out.replace(SENSITIVE_QUERY, (_m, prefix: string) => `${prefix}[redacted]`);
  out = out.replace(EMAIL, (m) => `[email:${tag(m.toLowerCase())}]`);
  return out;
}

/**
 * Credential-shapes only: no truncation, no email tagging, nothing else touched.
 *
 * For content stores — the transcript — where the text *is* the product and must survive
 * intact enough to reopen a conversation, but where a key pasted into a message must not
 * be written to disk. Removing the credential is also right on the way back in: an agent
 * resuming a conversation has no business being handed a secret from the last one.
 */
export function redactSecrets(input: string): string {
  let out = input;
  for (const { kind, re } of SECRET_VALUE) {
    out = out.replace(re, () => `[redacted:${kind}]`);
  }
  return out.replace(SENSITIVE_QUERY, (_m, prefix: string) => `${prefix}[redacted]`);
}

/**
 * Redacts an arbitrary value for logging.
 *
 * Cycles and depth are bounded because a log call must never be the thing that takes the
 * process down — a record that would recurse forever is replaced by a marker and the run
 * continues.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const cleaned = redactString(value);
    return cleaned.length > MAX_STRING ? `${cleaned.slice(0, MAX_STRING)}…(${cleaned.length})` : cleaned;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (depth >= MAX_DEPTH) return '[depth]';
  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
    if (Array.isArray(value)) {
      // Arrays are bounded too: a 10k-element array in a log line helps nobody and is
      // the shape that quietly triples the bill.
      const head = value.slice(0, 50).map((v) => redact(v, depth + 1, seen));
      return value.length > 50 ? [...head, `…(${value.length} items)`] : head;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sensitiveKey(k) ? '[redacted]' : redact(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

/** Record-level form: the shape `Logger.log` hands to a sink. */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redact(fields) as Record<string, unknown>;
}
