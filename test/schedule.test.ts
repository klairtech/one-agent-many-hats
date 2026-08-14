/**
 * The scheduler's failure modes are all silent ones: firing at the wrong hour twice a year,
 * firing twice, never firing, or — the one that matters — approving a mutation because
 * nobody was there to say no. Each gets a test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { describeSchedule, nextFire, parseSchedule } from '../src/schedule/cron.js';
import {
  assertUnattendedProfile,
  summariseDecisions,
  unattendedApprover,
  unattendedAsker,
  type UnattendedDecision,
} from '../src/schedule/unattended.js';
import { createSchedule, dueNow, listSchedules } from '../src/schedule/store.js';
import { isHatsError } from '../src/core/errors.js';
import { cleanup, tempHome } from './helpers.js';

test('cron fields parse, including names, steps, ranges and lists', () => {
  const at7 = parseSchedule('0 7 * * 1-5');
  assert.equal(at7.kind, 'cron');
  const next = nextFire(at7, new Date('2026-03-02T06:00:00'));
  assert.equal(next?.getHours(), 7);
  assert.equal(next?.getMinutes(), 0);

  // Saturday 06:00 must skip forward to Monday, not fire on the weekend.
  const weekend = nextFire(at7, new Date('2026-03-07T06:00:00'));
  assert.equal(weekend?.getDay(), 1, 'expected Monday');

  const named = parseSchedule('30 9 * jan-feb mon');
  assert.ok(named.kind === 'cron' && named.fields.month.has(1) && named.fields.month.has(2));
  assert.ok(named.kind === 'cron' && !named.fields.month.has(3));

  const stepped = parseSchedule('*/15 * * * *');
  assert.ok(stepped.kind === 'cron' && stepped.fields.minute.has(45));
  assert.ok(stepped.kind === 'cron' && !stepped.fields.minute.has(46));

  assert.equal(describeSchedule(parseSchedule('@daily')), '@daily (0 0 * * *)');
});

/**
 * The whole reason next-fire walks wall-clock fields instead of adding milliseconds.
 * US DST began 2026-03-08; a 07:00 schedule must still be 07:00 on the clock the next day.
 */
test('a daily time survives a DST boundary', () => {
  const daily = parseSchedule('0 7 * * *');
  const before = nextFire(daily, new Date('2026-03-07T08:00:00'));
  assert.equal(before?.getHours(), 7, 'the day the clocks change');
  const after = nextFire(daily, new Date('2026-03-08T08:00:00'));
  assert.equal(after?.getHours(), 7, 'the day after');
  // And the gap between them is not 24 hours in a DST zone, which is exactly why epoch
  // arithmetic gets this wrong.
  assert.equal(after?.getDate(), 9);
});

test('an expression that can never match returns null instead of looping', () => {
  // 31 February.
  assert.equal(nextFire(parseSchedule('0 0 31 2 *'), new Date('2026-01-01T00:00:00')), null);
});

test('malformed expressions are refused with a usable message', () => {
  for (const bad of ['', 'not a cron', '0 7 * *', '99 * * * *', '0 7 * * 1-0', '@every 10s']) {
    assert.throws(() => parseSchedule(bad), (e: unknown) => isHatsError(e), `accepted "${bad}"`);
  }
});

test('@every spaces from the last fire and does not replay a missed week', () => {
  const every = parseSchedule('@every 30m');
  const last = new Date('2026-08-01T00:00:00');
  const now = new Date('2026-08-08T00:00:00');
  const next = nextFire(every, now, last);
  // A week late: fire once shortly, not 336 times.
  assert.ok(next !== null && next > now, 'must be in the future');
  assert.ok(next.getTime() - now.getTime() <= 60_000);
});

test('trusted is refused for an unattended run', () => {
  assert.throws(
    () => assertUnattendedProfile('trusted'),
    (e: unknown) => isHatsError(e) && /no session/.test((e as Error).message),
  );
  assert.doesNotThrow(() => assertUnattendedProfile('read-only'));
  assert.doesNotThrow(() => assertUnattendedProfile('assisted'));
});

test('the unattended approver denies by default and records every decision', async () => {
  const home = await tempHome();
  const decisions: UnattendedDecision[] = [];
  const approve = unattendedApprover(
    {
      profile: 'assisted',
      allowTools: ['write_file'],
      trigger: { kind: 'schedule', id: 'sch_x', actor: 'sandeep' },
      workspace: '/tmp/ws',
    },
    decisions,
  );

  assert.equal(await approve({ tool: 'write_file', headline: 'write a.txt', detail: '' }), true);
  assert.equal(await approve({ tool: 'run_command', headline: 'rm -rf /', detail: '' }), false);
  assert.equal(await approve({ tool: 'apply_patch', headline: 'edit b.ts', detail: '' }), false);

  assert.equal(decisions.length, 3, 'every decision is recorded, not just the denials');
  assert.deepEqual(decisions.map((d) => d.allowed), [true, false, false]);
  assert.match(decisions[0]?.reason ?? '', /pre-authorised by sandeep/);

  const summary = summariseDecisions(decisions);
  assert.match(summary, /write_file/);
  assert.match(summary, /blocked/);
  assert.match(summary, /run_command, apply_patch/);
  await cleanup(home);
});

test('an empty allow list approves nothing at all', async () => {
  const home = await tempHome();
  const decisions: UnattendedDecision[] = [];
  const approve = unattendedApprover(
    {
      profile: 'assisted',
      allowTools: [],
      trigger: { kind: 'message', id: 'tg:1', actor: 'x' },
      workspace: '/tmp/ws',
    },
    decisions,
  );
  for (const tool of ['write_file', 'apply_patch', 'run_command', 'propose_tool']) {
    assert.equal(await approve({ tool, headline: '', detail: '' }), false, `${tool} was approved`);
  }
  await cleanup(home);
});

test('a clarification ends an unattended run rather than being guessed at', async () => {
  const ask = unattendedAsker();
  await assert.rejects(
    () => ask({ question: 'which database?', options: ['a', 'b'] }),
    (e: unknown) => isHatsError(e) && (e as { code: string }).code === 'CLARIFICATION_REQUIRED',
  );
});

test('creating a schedule validates before it writes anything', async () => {
  const home = await tempHome();
  try {
    await assert.rejects(
      () => createSchedule({ request: 'x', expression: '@daily', workspace: '/tmp', profile: 'trusted' }),
      (e: unknown) => isHatsError(e) && /trusted/.test((e as Error).message),
    );
    await assert.rejects(
      () => createSchedule({ request: 'x', expression: 'nonsense', workspace: '/tmp' }),
      (e: unknown) => isHatsError(e),
    );
    await assert.rejects(
      () => createSchedule({ request: '', expression: '@daily', workspace: '/tmp' }),
      (e: unknown) => isHatsError(e),
    );
    // An allow list under read-only would never apply; say so rather than ignore it.
    await assert.rejects(
      () =>
        createSchedule({
          request: 'x',
          expression: '@daily',
          workspace: '/tmp',
          allowTools: ['write_file'],
        }),
      (e: unknown) => isHatsError(e) && /assisted/.test((e as Error).message),
    );

    assert.equal((await listSchedules()).length, 0, 'nothing was written by a refused create');

    const ok = await createSchedule({ request: 'check prices', expression: '0 7 * * *', workspace: '/tmp' });
    assert.equal(ok.profile, 'read-only', 'the default is the safe one');
    assert.deepEqual(ok.allowTools, []);
    assert.ok(ok.author, 'a schedule records who created it');
    assert.equal((await listSchedules()).length, 1);
  } finally {
    await cleanup(home);
  }
});

test('a machine that was asleep fires once and reports what it missed', async () => {
  const home = await tempHome();
  try {
    const rec = await createSchedule({
      request: 'hourly check',
      expression: '@hourly',
      workspace: '/tmp',
    });
    const asleep = {
      ...rec,
      lastRunAt: new Date('2026-08-01T00:00:00').toISOString(),
    };
    const now = new Date('2026-08-02T00:30:00');
    const { due, missed } = dueNow(asleep, now);
    assert.equal(due, true);
    assert.ok(missed > 20, `expected a day of missed hourly firings, got ${missed}`);

    // Just run: not due again until the next hour.
    const fresh = { ...rec, lastRunAt: new Date('2026-08-02T00:00:00').toISOString() };
    assert.equal(dueNow(fresh, new Date('2026-08-02T00:30:00')).due, false);
    assert.equal(dueNow(fresh, new Date('2026-08-02T01:00:30')).due, true);
  } finally {
    await cleanup(home);
  }
});

test('a disabled schedule is never due', async () => {
  const home = await tempHome();
  try {
    const rec = await createSchedule({ request: 'x', expression: '@hourly', workspace: '/tmp' });
    const off = { ...rec, enabled: false, lastRunAt: new Date('2020-01-01T00:00:00').toISOString() };
    assert.equal(dueNow(off, new Date()).due, false);
  } finally {
    await cleanup(home);
  }
});

/**
 * The miner must report broken tools, not unwelcome answers. `check_consistency` returning
 * FAIL and `run_command` exiting non-zero are both `ok: false`, and neither is a defect —
 * before this it re-staged the same three reports after every single run.
 */
test('only a thrown error counts as a tool malfunction', async () => {
  const home = await tempHome();
  try {
    const { mineProposals } = await import('../src/engine/mine.js');
    const { listProposals } = await import('../src/registry/proposals.js');
    const { workspaceDir } = await import('../src/core/paths.js');
    const { ensureDir, writeJsonAtomic } = await import('../src/core/store.js');
    const pathMod = await import('node:path');
    const { testConfig } = await import('./helpers.js');

    const slug = 'ws-test';
    for (let i = 0; i < 4; i++) {
      const dir = await ensureDir(pathMod.join(workspaceDir(slug), 'runs', `run${i}`));
      await writeJsonAtomic(pathMod.join(dir, 'run.json'), {
        runId: `run${i}`,
        request: `unrelated request ${i}`,
        outcomeId: 'outcome/investigate',
        ok: true,
        observations: [
          // A verdict, not a defect: no errorCode.
          { tool: 'check_consistency', ok: false, summary: 'FAIL: 4/7 reconciled' },
          // A command that failed, which is the command's news.
          { tool: 'run_command', ok: false, summary: 'exit 1' },
          // A denial: the system working.
          { tool: 'write_file', ok: false, errorCode: 'APPROVAL_DENIED', ruleId: 'rule/x' },
          // An actual malfunction.
          { tool: 'browser_act', ok: false, errorCode: 'TOOL_FAILED', summary: 'nothing matches "x"' },
        ],
      });
    }

    await mineProposals(slug, testConfig());
    const titles = (await listProposals()).map((p) => p.title);
    assert.ok(
      titles.some((t) => t.includes('browser_act')),
      'the real malfunction was not reported',
    );
    for (const quiet of ['check_consistency', 'run_command', 'write_file']) {
      assert.ok(!titles.some((t) => t.includes(quiet)), `${quiet} was wrongly reported as broken`);
    }
  } finally {
    await cleanup(home);
  }
});
