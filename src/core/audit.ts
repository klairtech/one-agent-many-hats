/**
 * The accountability record.
 *
 * This is deliberately not `Logger` with a different filename. The run's `audit.jsonl` is
 * an application log that happens to be called audit: it holds `run.step` and `tool.call`
 * detail, it lives and dies with the run directory, and it answers "why was this slow".
 * That is a different job from answering "who did what to whose data, when, and did it
 * succeed" — a question that arrives from a person or an obligation, months later, about
 * a subject rather than about a run.
 *
 * The differences are the point:
 *  - **One stream, not one per run.** The question is "everything done to this workspace",
 *    which cannot be answered by a store partitioned by the thing you are searching for.
 *  - **Its own retention.** Application logs are kept for debugging and can be aged out in
 *    weeks. This is kept because someone may ask, which is a longer and different clock.
 *  - **Restricted and tamper-evident.** 0600, append-only, and each record carries a hash
 *    chained to the previous one, so a record that is edited or removed after the fact
 *    breaks the chain and can be detected. This does not stop a determined local root —
 *    nothing a process can do to its own files would — but it does mean silent edits stop
 *    being silent, which is the property the log is actually relied on for.
 *  - **Complete.** A partial audit trail is worse than none, because it invites confident
 *    wrong conclusions. So writes here are awaited rather than fire-and-forget, and a
 *    failure is surfaced to the caller instead of being counted and dropped.
 *
 * What belongs here: authentication and its failures, authorisation denials, permission
 * and grant changes, credential changes, data export, deletion, admin or tool access to
 * workspace data, and configuration changes. What does not: anything you would read while
 * debugging a slow run.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { redactFields } from './redact.js';
import { hatsHome } from './paths.js';
import { createHash } from 'node:crypto';

const MODE = 0o600;

/** The kinds of thing an audit record can describe. Closed set, so queries stay stable. */
export type AuditAction =
  | 'auth.accepted'
  | 'auth.rejected'
  | 'authz.denied'
  | 'authz.granted'
  | 'grant.created'
  | 'grant.used'
  | 'grant.revoked'
  | 'credential.set'
  | 'credential.cleared'
  | 'config.changed'
  | 'data.read'
  | 'data.written'
  | 'data.exported'
  | 'data.deleted'
  | 'schedule.created'
  | 'schedule.deleted'
  | 'run.started'
  | 'run.finished'
  | 'tool.installed'
  | 'registry.promoted';

export interface AuditRecord {
  ts: string;
  action: AuditAction;
  /** Who: the channel identity, the local user, or `system` for the scheduler. */
  actor: string;
  /** Where from: channel name, `cli`, `panel`, `scheduler`. */
  source: string;
  /** Whose data: the workspace slug. The field queries are written against. */
  subject: string | null;
  /** Did it succeed. An audit log of only successes answers none of the real questions. */
  outcome: 'allowed' | 'denied' | 'failed';
  runId?: string;
  detail?: Record<string, unknown>;
  /** sha256 over the previous record's hash and this record's body. */
  hash?: string;
  prev?: string;
}

export function auditLogPath(): string {
  return path.join(hatsHome(), 'audit', 'audit.jsonl');
}

/** Last hash seen this process, so the chain does not require a read per write. */
let lastHash: string | null = null;
/** Writes are serialised: two appends must not interleave or the chain forks. */
let queue: Promise<void> = Promise.resolve();

function bodyHash(record: Omit<AuditRecord, 'hash'>, prev: string): string {
  return createHash('sha256').update(prev).update(JSON.stringify(record)).digest('hex');
}

/** Reads the tail hash once per process so a restart continues the existing chain. */
async function tailHash(file: string): Promise<string> {
  if (lastHash !== null) return lastHash;
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const lines = raw.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const parsed = JSON.parse(line) as AuditRecord;
      if (parsed.hash) {
        lastHash = parsed.hash;
        return lastHash;
      }
    }
  } catch {
    /* no file yet, or an unreadable tail: start a fresh chain from genesis */
  }
  lastHash = 'genesis';
  return lastHash;
}

/**
 * Appends one audit record.
 *
 * Awaited, not fire-and-forget: completeness is the property this stream exists for, so a
 * caller that must not proceed unrecorded can rely on the await. Errors propagate for the
 * same reason — a silently missing audit record is the failure mode being designed out.
 */
export async function audit(
  entry: Omit<AuditRecord, 'ts' | 'hash' | 'prev'>,
): Promise<void> {
  const file = auditLogPath();
  const run = queue.then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }).catch(() => undefined);
    const prev = await tailHash(file);
    const body: Omit<AuditRecord, 'hash' | 'prev'> = {
      ts: new Date().toISOString(),
      ...entry,
      ...(entry.detail ? { detail: redactFields(entry.detail) } : {}),
    };
    const record: AuditRecord = { ...body, prev, hash: bodyHash(body, prev) };
    await fsp.appendFile(file, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: MODE });
    await fsp.chmod(file, MODE).catch(() => undefined);
    lastHash = record.hash!;
  });
  // The chain must advance even if this caller's write failed, or every later record
  // would be verified against a hash that was never written.
  queue = run.catch(() => undefined);
  await run;
}

/** Non-throwing form, for paths where the caller genuinely cannot fail (shutdown). */
export async function auditQuietly(
  entry: Omit<AuditRecord, 'ts' | 'hash' | 'prev'>,
): Promise<void> {
  await audit(entry).catch(() => undefined);
}

export interface AuditVerification {
  records: number;
  intact: boolean;
  /** Index of the first record whose hash does not follow from its predecessor. */
  brokenAt: number | null;
}

/**
 * Recomputes the chain. This is what makes the log tamper-*evident* rather than merely
 * append-only: an edited or deleted record cannot be made to agree with its successors
 * without rewriting every one that follows.
 */
export async function verifyAuditChain(file = auditLogPath()): Promise<AuditVerification> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return { records: 0, intact: true, brokenAt: null };
  }
  const lines = raw.split('\n').filter((l) => l.trim());
  let prev = 'genesis';
  for (let i = 0; i < lines.length; i++) {
    let record: AuditRecord;
    try {
      record = JSON.parse(lines[i]!) as AuditRecord;
    } catch {
      return { records: lines.length, intact: false, brokenAt: i };
    }
    const { hash, prev: recordedPrev, ...body } = record;
    if (recordedPrev !== prev || hash !== bodyHash(body as Omit<AuditRecord, 'hash'>, prev)) {
      return { records: lines.length, intact: false, brokenAt: i };
    }
    prev = hash;
  }
  return { records: lines.length, intact: true, brokenAt: null };
}

/** Everything done to one workspace — the query the log is shaped for. */
export async function auditForSubject(
  subject: string,
  opts: { since?: Date; file?: string } = {},
): Promise<AuditRecord[]> {
  const file = opts.file ?? auditLogPath();
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return [];
  }
  const since = opts.since?.toISOString();
  const out: AuditRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as AuditRecord;
      if (record.subject !== subject) continue;
      if (since && record.ts < since) continue;
      out.push(record);
    } catch {
      /* torn line: skip, keep the rest usable */
    }
  }
  return out;
}

/** Test seam — the chain cache is process-global. */
export function resetAuditChainCache(): void {
  lastHash = null;
  queue = Promise.resolve();
}

/** Ensures the audit directory exists and is not world-readable, at startup. */
export function ensureAuditDirSync(): void {
  try {
    fs.mkdirSync(path.dirname(auditLogPath()), { recursive: true, mode: 0o700 });
  } catch {
    /* best effort: the first append will retry and surface a real failure */
  }
}
