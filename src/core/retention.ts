/**
 * Retention.
 *
 * Before this there was none. `core/space.ts` can reclaim disk when a person clicks the
 * button in the panel, which is a housekeeping tool, not a policy: nothing aged out on its
 * own, and every stream shared one lifecycle — the run's operational log, the raw
 * conversation content beside it, and the accountability record all kept forever by
 * default because nothing ever deleted anything.
 *
 * Those three have genuinely different clocks, and conflating them is what makes teams
 * either pay indefinitely or delete the one thing they needed:
 *
 *  - **Operational detail** (`audit.jsonl`, artifacts) is for debugging. It is worth a lot
 *    for days and almost nothing after a month. Aged out first.
 *  - **Conversation content** (`transcript.jsonl`) is the most sensitive thing on disk and
 *    the least often read. It gets the *shortest* clock, and it is removed independently of
 *    the run record around it, so a run stays explicable after its content is gone.
 *  - **The accountability record** (`$HATS_HOME/audit/audit.jsonl`) is kept because someone
 *    may ask. It is never swept here at all. Deleting it is a deliberate act with a legal
 *    question behind it, not a side effect of a disk-space routine, and its hash chain
 *    would be broken by trimming the front of the file in any case.
 *
 * All three defaults are deliberately conservative and configurable. The point is not the
 * numbers, it is that a number exists and is applied rather than assumed.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { hatsHome, workspaceDir } from './paths.js';
import { runtimeLogPath } from './logger.js';

export interface RetentionPolicy {
  /** Run directories older than this are removed entirely. */
  runDays: number;
  /** Transcripts are removed this many days in, leaving the run record behind. */
  transcriptDays: number;
  /** The runtime log is rotated once it passes this size, keeping one previous file. */
  runtimeLogMaxBytes: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  runDays: 30,
  transcriptDays: 7,
  runtimeLogMaxBytes: 32 * 1024 * 1024,
};

export interface RetentionResult {
  runsRemoved: number;
  transcriptsRemoved: number;
  bytesReclaimed: number;
  runtimeLogRotated: boolean;
  /** Streams deliberately left alone, so the report never reads as "everything was swept". */
  skipped: string[];
}

/** Run ids are `20260814T101500Z-a1b2c3`; the stamp is the age without reading the record. */
function runIdAge(id: string, now: number): number | null {
  const m = /^(\d{8})T(\d{6})Z/.exec(id);
  if (!m) return null;
  const [, d, t] = m;
  const iso = `${d!.slice(0, 4)}-${d!.slice(4, 6)}-${d!.slice(6, 8)}T${t!.slice(0, 2)}:${t!.slice(2, 4)}:${t!.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : (now - ms) / 86_400_000;
}

async function sizeOf(target: string): Promise<number> {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += (await fsp.stat(full)).size;
        } catch {
          /* vanished mid-sweep: not an error, just no longer our problem */
        }
      }
    }
  }
  return total;
}

/**
 * Applies the policy to one workspace.
 *
 * Never throws: a sweep that fails must not take down the daemon that called it, and a
 * partially applied sweep is safe to repeat — every action here is idempotent.
 */
export async function sweepWorkspace(
  slug: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now = Date.now(),
): Promise<RetentionResult> {
  const result: RetentionResult = {
    runsRemoved: 0,
    transcriptsRemoved: 0,
    bytesReclaimed: 0,
    runtimeLogRotated: false,
    skipped: ['audit (kept on its own schedule)'],
  };
  const runsDir = path.join(workspaceDir(slug), 'runs');
  let ids: string[];
  try {
    ids = await fsp.readdir(runsDir);
  } catch {
    return result;
  }

  for (const id of ids) {
    const age = runIdAge(id, now);
    if (age === null) continue; // not a run directory we recognise: leave it alone
    const dir = path.join(runsDir, id);

    if (age > policy.runDays) {
      result.bytesReclaimed += await sizeOf(dir);
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      result.runsRemoved++;
      continue;
    }

    if (age > policy.transcriptDays) {
      const transcript = path.join(dir, 'transcript.jsonl');
      try {
        const { size } = await fsp.stat(transcript);
        await fsp.rm(transcript, { force: true });
        result.bytesReclaimed += size;
        result.transcriptsRemoved++;
      } catch {
        /* already gone: the desired state, so nothing to do */
      }
    }
  }
  return result;
}

/**
 * Rotates the runtime log once it grows past the cap, keeping exactly one previous file.
 *
 * One generation, not many: this log is for "what was the daemon doing recently", and a
 * pile of numbered archives is cost pretending to be diligence.
 */
export async function rotateRuntimeLog(
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<boolean> {
  const file = runtimeLogPath();
  try {
    const { size } = await fsp.stat(file);
    if (size < policy.runtimeLogMaxBytes) return false;
    await fsp.rename(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

/** Every workspace, plus the runtime log. Safe to call on a timer. */
export async function sweepAll(
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now = Date.now(),
): Promise<RetentionResult> {
  const total: RetentionResult = {
    runsRemoved: 0,
    transcriptsRemoved: 0,
    bytesReclaimed: 0,
    runtimeLogRotated: false,
    skipped: ['audit (kept on its own schedule)'],
  };
  let slugs: string[] = [];
  try {
    slugs = await fsp.readdir(path.join(hatsHome(), 'workspaces'));
  } catch {
    slugs = [];
  }
  for (const slug of slugs) {
    const one = await sweepWorkspace(slug, policy, now);
    total.runsRemoved += one.runsRemoved;
    total.transcriptsRemoved += one.transcriptsRemoved;
    total.bytesReclaimed += one.bytesReclaimed;
  }
  total.runtimeLogRotated = await rotateRuntimeLog(policy);
  return total;
}
