/**
 * Retention, and the runtime sink.
 *
 * Both are the kind of thing that is easy to believe is working. A sweep that silently
 * matches nothing looks identical to a store with nothing to sweep, and a logger with no
 * file sink looks exactly like a logger — which is how 28 emit sites came to be discarded
 * without anyone noticing.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { runtimeLogPath, runtimeLogger } from '../src/core/logger.js';
import { workspaceDir } from '../src/core/paths.js';
import { DEFAULT_RETENTION, sweepWorkspace } from '../src/core/retention.js';
import { readJsonl } from '../src/core/store.js';
import { cleanup, tempHome } from './helpers.js';

/** Builds a run directory whose id encodes the given age in days. */
async function seedRun(slug: string, ageDays: number): Promise<string> {
  const when = new Date(Date.now() - ageDays * 86_400_000);
  const stamp = when.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const id = `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
  const dir = path.join(workspaceDir(slug), 'runs', id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'audit.jsonl'), '{"event":"run.started"}\n');
  await fsp.writeFile(path.join(dir, 'transcript.jsonl'), '{"role":"user","content":"hello"}\n');
  await fsp.writeFile(path.join(dir, 'run.json'), '{"ok":true}\n');
  return dir;
}

test('the three streams age out on their own clocks', async () => {
  const home = await tempHome();
  try {
    const slug = 'ws-retention';
    const fresh = await seedRun(slug, 1);
    const middling = await seedRun(slug, 14);
    const ancient = await seedRun(slug, 90);

    const result = await sweepWorkspace(slug, DEFAULT_RETENTION);

    // Recent: untouched, content and all.
    assert.ok(await exists(path.join(fresh, 'transcript.jsonl')), 'a day-old transcript was swept');

    // Past the transcript clock but inside the run clock: the conversation content goes,
    // the run stays explicable. This is the case the separate clocks exist for.
    assert.ok(!(await exists(path.join(middling, 'transcript.jsonl'))), 'a 14-day transcript survived');
    assert.ok(await exists(path.join(middling, 'audit.jsonl')), 'the operational log went with it');
    assert.ok(await exists(path.join(middling, 'run.json')), 'the run record went with it');

    // Past the run clock: gone entirely.
    assert.ok(!(await exists(ancient)), 'a 90-day run survived');

    assert.equal(result.runsRemoved, 1);
    assert.equal(result.transcriptsRemoved, 1);
    assert.ok(result.bytesReclaimed > 0, 'reclaimed nothing while removing files');
    // The report must never read as "everything was swept" when audit deliberately was not.
    assert.ok(result.skipped.some((s) => s.includes('audit')), 'the audit stream was not named as skipped');
  } finally {
    await cleanup(home);
  }
});

test('sweeping is idempotent and survives a store that is not there', async () => {
  const home = await tempHome();
  try {
    // A sweep on a fresh install must not throw — it runs from the scheduler daemon, where
    // an exception would be a crash loop rather than a missing directory.
    const empty = await sweepWorkspace('never-existed');
    assert.equal(empty.runsRemoved, 0);

    const slug = 'ws-twice';
    await seedRun(slug, 90);
    const first = await sweepWorkspace(slug);
    const second = await sweepWorkspace(slug);
    assert.equal(first.runsRemoved, 1);
    assert.equal(second.runsRemoved, 0, 'the second sweep removed something again');
  } finally {
    await cleanup(home);
  }
});

test('a runtime logger actually writes, and carries its component', async () => {
  const home = await tempHome();
  try {
    const log = runtimeLogger('schedule');
    log.info('scheduler.started', { tickMs: 30_000 });
    log.warn('schedule.skipped.inflight', { scheduleId: 'sch_1' });
    await log.flush();

    const records = await readJsonl<Record<string, unknown>>(runtimeLogPath());
    assert.equal(records.length, 2, 'records did not reach the runtime log');
    assert.equal(records[0]?.['component'], 'schedule');
    assert.equal(records[0]?.['event'], 'scheduler.started');
    assert.equal(records[1]?.['level'], 'warn');
    // Prose event names were the old convention here and are unqueryable; a dotted name is
    // the interface every saved query is written against.
    for (const r of records) {
      assert.doesNotMatch(String(r['event']), / /, `event name is prose: ${String(r['event'])}`);
    }
  } finally {
    await cleanup(home);
  }
});

async function exists(target: string): Promise<boolean> {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}
