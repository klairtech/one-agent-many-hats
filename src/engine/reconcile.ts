/**
 * Reconciliation: does every specific in the draft exist in the run's evidence?
 *
 * This is the coded half of rule/no-invented-numbers, and it is a heuristic. Both error
 * modes are stated in that rule; the design bias here is to be generous about formatting
 * (1,234 vs 1234 vs 1234.0) and strict about existence, so that a false alarm costs a
 * correction pass while a fabrication is unlikely to slip through.
 */

import type { Artifact } from '../tools/artifacts.js';

export type ClaimKind = 'number' | 'path' | 'artifact';

export interface Claim {
  token: string;
  kind: ClaimKind;
  /** Normalised form used for matching. */
  normalised: string;
}

export interface CheckedClaim extends Claim {
  supported: boolean;
  foundIn?: string;
}

export interface ReconcileReport {
  checked: CheckedClaim[];
  unsupported: CheckedClaim[];
}

/**
 * Numbers below this are treated as prose ("three steps", "2 files") rather than claims.
 * Small integers are where false positives concentrate, and where fabrication matters
 * least.
 */
const TRIVIAL_MAX = 3;

const NUMBER_RE = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*%?/g;
const PATH_RE = /(?<![\w/])((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.[a-zA-Z]{1,8})(?![\w/])/g;
const ARTIFACT_RE = /\bart_[a-f0-9]{6,}\b/g;

export function extractClaims(draft: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  // Artifact citations are stripped first so their hex digits are not read as numbers.
  const artifactIds = draft.match(ARTIFACT_RE) ?? [];
  const withoutArtifacts = draft.replace(ARTIFACT_RE, ' ');

  for (const id of artifactIds) {
    if (add(seen, `artifact:${id}`)) claims.push({ token: id, kind: 'artifact', normalised: id });
  }

  for (const m of withoutArtifacts.matchAll(PATH_RE)) {
    const token = m[1];
    if (!token) continue;
    if (!/[./]/.test(token)) continue;
    // A "path" whose every segment is digits is a ratio or a date — 26/26, 12/08/2026,
    // 1.5 — not a file. Demanding to find it in an artifact stamps a correct answer as
    // unverified, which costs more trust than the gate earns. It falls through to the
    // number pass below, where it is checked as a value instead.
    // [Found by a live run whose only "unreconciled" token was the reviewer's own
    // "26/26 specifics reconciled" score, 2026-08-14.]
    if (/^[\d.,/]+$/.test(token)) continue;
    // "source/destination", "to/from", "read/write" are prose, not files. A real path in an
    // answer almost always carries an extension or a directory that exists in a project; an
    // English word pair carries neither, and demanding it be found in an artifact blocked
    // two delivered answers on nothing. [Seen in a live run, 2026-08-15.]
    if (!looksLikePath(token)) continue;
    if (add(seen, `path:${token}`)) {
      claims.push({ token, kind: 'path', normalised: token.toLowerCase() });
    }
  }

  // Ratios and dates are put back for the number pass; only real paths are removed.
  const withoutPaths = withoutArtifacts.replace(PATH_RE, (m) => (/^[\d.,/]+$/.test(m) ? m : ' '));
  for (const m of withoutPaths.matchAll(NUMBER_RE)) {
    const raw = m[1];
    if (!raw) continue;
    const numeric = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(numeric)) continue;
    if (Math.abs(numeric) <= TRIVIAL_MAX && Number.isInteger(numeric)) continue;
    if (/^(19|20)\d{2}$/.test(raw)) continue; // years read as prose more often than as claims
    if (add(seen, `number:${numeric}`)) {
      claims.push({ token: raw, kind: 'number', normalised: normaliseNumber(numeric) });
    }
  }

  return claims;
}

/**
 * A slash between two dictionary words is not a path. Requires an extension, punctuation
 * that prose does not use, a recognisable source directory, or three or more segments.
 */
function looksLikePath(token: string): boolean {
  if (/\.[a-zA-Z0-9]{1,8}$/.test(token)) return true;
  if (/[_~]|\.\.?\//.test(token)) return true;
  const segments = token.split('/').filter(Boolean);
  const DIRS = new Set([
    'src', 'test', 'tests', 'lib', 'dist', 'docs', 'doc', 'packs', 'assets', 'scripts',
    'runtime', 'public', 'app', 'bin', 'config', 'node_modules', 'build', 'out', 'data',
  ]);
  if (DIRS.has((segments[0] ?? '').toLowerCase())) return true;
  return segments.length >= 3;
}

export function reconcile(claims: Claim[], artifacts: Artifact[]): ReconcileReport {
  const haystacks = artifacts.map((a) => ({
    id: a.id,
    tool: a.tool,
    text: `${a.summary}\n${safeStringify(a.payload)}\n${safeStringify(a.provenance)}`.toLowerCase(),
    numbers: collectNumbers(a),
  }));

  const checked: CheckedClaim[] = claims.map((claim) => {
    for (const h of haystacks) {
      if (claim.kind === 'artifact') {
        if (h.id === claim.token) return { ...claim, supported: true, foundIn: h.id };
        continue;
      }
      if (claim.kind === 'path') {
        if (h.text.includes(claim.normalised)) {
          return { ...claim, supported: true, foundIn: `${h.id}/${h.tool}` };
        }
        continue;
      }
      if (h.numbers.has(claim.normalised)) {
        return { ...claim, supported: true, foundIn: `${h.id}/${h.tool}` };
      }
    }
    return { ...claim, supported: false };
  });

  return { checked, unsupported: checked.filter((c) => !c.supported) };
}

/**
 * Every number an artifact contains, in normalised form — including ones nested in
 * payload objects, because "the file has 348 lines" should reconcile against a payload
 * field, not only against the summary string.
 */
function collectNumbers(artifact: Artifact): Set<string> {
  const out = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.add(normaliseNumber(value));
      // Percentages are written either way round; accept both.
      out.add(normaliseNumber(value * 100));
      return;
    }
    if (typeof value === 'string') {
      for (const m of value.matchAll(NUMBER_RE)) {
        const n = Number((m[1] ?? '').replace(/,/g, ''));
        if (Number.isFinite(n)) out.add(normaliseNumber(n));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) visit(v, depth + 1);
    }
  };
  visit(artifact.payload, 0);
  visit(artifact.summary, 0);
  visit(artifact.provenance, 0);
  return out;
}

/** 1,234 / 1234 / 1234.00 all normalise to the same key; 12.34% and 0.1234 do not. */
function normaliseNumber(n: number): string {
  const rounded = Math.abs(n) < 1 ? Number(n.toFixed(6)) : Number(n.toFixed(2));
  return String(rounded);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function add(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
