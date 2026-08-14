/**
 * Schedule records: one JSON file each under `$HATS_HOME/schedules`.
 *
 * One file per schedule rather than one array in one file, because the panel, the CLI and
 * the daemon all write these and a read-modify-write of a shared array loses edits. Each
 * writer only ever touches its own file, atomically (ADR-0003).
 */

import path from 'node:path';
import { unlink } from 'node:fs/promises';

import { HatsError } from '../core/errors.js';
import type { Profile } from '../core/config.js';
import { schedulesDir } from '../core/paths.js';
import { ensureDir, exists, listFiles, readJson, shortHash, writeJsonAtomic } from '../core/store.js';
import { assertUnattendedProfile } from './unattended.js';
import { describeSchedule, nextFire, parseSchedule } from './cron.js';

export interface ScheduleRecord {
  id: string;
  /** What to ask the agent. The prompt half of the audit trail's "person and a prompt". */
  request: string;
  /** Cron expression or @every form, as typed. */
  expression: string;
  workspace: string;
  profile: Profile;
  /** ADR-0007 §4: tools a human named at creation time as safe to run unattended. */
  allowTools: string[];
  /** Who created it. The person half of the audit trail. */
  author: string;
  enabled: boolean;
  createdAt: string;
  /** ISO of the last time this fired, used for @every spacing and catch-up. */
  lastRunAt?: string;
  lastRunId?: string;
  lastStatus?: 'ok' | 'failed' | 'skipped';
  lastSummary?: string;
  /** Where to send the result. Empty means the panel and the run record only. */
  notify?: { channel: string; to: string };
  /** Runs that did not happen because the machine was off. Reported, not replayed. */
  missedRuns?: number;
}

export interface NewSchedule {
  request: string;
  expression: string;
  workspace: string;
  profile?: Profile;
  allowTools?: string[];
  author?: string;
  notify?: { channel: string; to: string };
}

export async function createSchedule(input: NewSchedule): Promise<ScheduleRecord> {
  // Both of these throw before anything is written, while a human is present to read them.
  const schedule = parseSchedule(input.expression);
  const profile = input.profile ?? 'read-only';
  assertUnattendedProfile(profile);

  if (!input.request.trim()) {
    throw new HatsError('CONFIG_INVALID', 'a schedule needs a request', {});
  }
  if (nextFire(schedule, new Date()) === null) {
    throw new HatsError(
      'CONFIG_INVALID',
      `"${input.expression}" never fires — check the day and month fields`,
      { expression: input.expression },
    );
  }
  // An allow list on a read-only schedule reads as a grant that will never apply. Say so
  // rather than accepting it and silently ignoring it.
  const allowTools = input.allowTools ?? [];
  if (profile === 'read-only' && allowTools.length > 0) {
    throw new HatsError(
      'CONFIG_INVALID',
      'allow-tool needs profile assisted: under read-only the tools are not in the allowlist ' +
        'at all, so pre-authorising them would have no effect',
      { allowTools, profile },
    );
  }

  const record: ScheduleRecord = {
    id: `sch_${shortHash(`${input.request}${input.expression}${Date.now()}`)}`,
    request: input.request.trim(),
    expression: schedule.expression,
    workspace: input.workspace,
    profile,
    allowTools,
    author: input.author ?? localActor(),
    enabled: true,
    createdAt: new Date().toISOString(),
    ...(input.notify ? { notify: input.notify } : {}),
  };

  await saveSchedule(record);
  return record;
}

export async function saveSchedule(record: ScheduleRecord): Promise<void> {
  const dir = await ensureDir(schedulesDir());
  await writeJsonAtomic(path.join(dir, `${record.id}.json`), record);
}

export async function listSchedules(): Promise<ScheduleRecord[]> {
  const dir = schedulesDir();
  if (!(await exists(dir))) return [];
  // listFiles returns absolute paths, not basenames.
  const files = await listFiles(dir, '.json');
  const out: ScheduleRecord[] = [];
  for (const file of files) {
    const rec = await readJson<ScheduleRecord | null>(file, null);
    if (rec?.id) out.push(rec);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getSchedule(id: string): Promise<ScheduleRecord> {
  const all = await listSchedules();
  // Accept an unambiguous prefix; the ids are hashes and nobody types them in full.
  const hits = all.filter((s) => s.id === id || s.id.startsWith(id));
  if (hits.length === 0) {
    throw new HatsError('REGISTRY_NOT_FOUND', `no schedule "${id}"`, { known: all.map((s) => s.id) });
  }
  if (hits.length > 1) {
    throw new HatsError('CONFIG_INVALID', `"${id}" matches ${hits.length} schedules`, {
      matches: hits.map((s) => s.id),
    });
  }
  return hits[0] as ScheduleRecord;
}

export async function deleteSchedule(id: string): Promise<ScheduleRecord> {
  const rec = await getSchedule(id);
  await unlink(path.join(schedulesDir(), `${rec.id}.json`));
  return rec;
}

/** Next firing for a record, or null if it is disabled or unsatisfiable. */
export function nextFireFor(record: ScheduleRecord, now = new Date()): Date | null {
  if (!record.enabled) return null;
  const schedule = parseSchedule(record.expression);
  const last = record.lastRunAt ? new Date(record.lastRunAt) : undefined;
  return nextFire(schedule, now, last);
}

/**
 * Whether this schedule is owed a run.
 *
 * A machine that was asleep for a week has missed dozens of firings. Those are counted and
 * reported, then a single run happens — replaying a week of "check the prices" would be
 * both useless and expensive.
 */
export function dueNow(record: ScheduleRecord, now = new Date()): { due: boolean; missed: number } {
  if (!record.enabled) return { due: false, missed: 0 };
  const schedule = parseSchedule(record.expression);

  if (!record.lastRunAt) {
    // Never run: due only from its next natural firing, not immediately on creation.
    const first = nextFire(schedule, new Date(record.createdAt));
    return { due: first !== null && first <= now, missed: 0 };
  }

  const last = new Date(record.lastRunAt);
  let cursor = nextFire(schedule, last, last);
  if (cursor === null || cursor > now) return { due: false, missed: 0 };

  let missed = 0;
  // Count the firings that were passed over, bounded so a long outage cannot spin here.
  while (cursor !== null && cursor <= now && missed < 1000) {
    const following = nextFire(schedule, cursor, cursor);
    if (following === null || following > now) break;
    cursor = following;
    missed++;
  }
  return { due: true, missed };
}

export function describeRecord(record: ScheduleRecord): string {
  return describeSchedule(parseSchedule(record.expression));
}

function localActor(): string {
  return process.env['USER'] ?? process.env['USERNAME'] ?? 'local user';
}
