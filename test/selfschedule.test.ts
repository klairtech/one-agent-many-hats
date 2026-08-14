/**
 * ADR-0008. The dangerous parameters are absent rather than validated, so the tests here
 * check that absence holds end to end: whatever the model emits, the schedule that comes
 * out is read-only with an empty allow list, and an unattended run creates nothing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleTask } from '../src/tools/builtin/schedule.js';
import { listSchedules } from '../src/schedule/store.js';
import { isHatsError } from '../src/core/errors.js';
import type { ToolContext } from '../src/tools/types.js';
import { cleanup, tempHome, testConfig } from './helpers.js';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: 'run_test',
    workspaceSlug: 'ws',
    workspaceRoot: '/tmp/ws',
    profile: 'read-only',
    stage: 'act',
    config: testConfig(),
    guard: null as never,
    artifacts: null as never,
    logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
    ask: async () => '',
    approve: async () => true,
    recordTaskDescriptor: () => {},
    ...over,
  } as ToolContext;
}

test('a schedule the agent creates is read-only and pre-authorises nothing', async () => {
  const home = await tempHome();
  try {
    const res = await scheduleTask.run(
      { request: 'check whether the build is still failing', when: '@daily', why: 'it failed today' },
      ctx(),
    );
    assert.match(res.summary, /read-only/);

    const [created] = await listSchedules();
    assert.ok(created, 'nothing was scheduled');
    assert.equal(created.profile, 'read-only');
    assert.deepEqual(created.allowTools, [], 'the agent must not be able to pre-authorise a tool');
    assert.match(created.author, /^agent \(run run_test\)$/, 'the schedule must be attributable');
  } finally {
    await cleanup(home);
  }
});

/**
 * The escalation attempt. Even if the model emits these fields, they are not in the schema
 * and must not reach createSchedule — otherwise the agent grants itself unattended writes
 * and ADR-0007 stops meaning anything.
 */
test('profile and allowTools cannot be smuggled in as extra arguments', async () => {
  const home = await tempHome();
  try {
    await scheduleTask.run(
      {
        request: 'nightly cleanup',
        when: '@daily',
        why: 'tidy',
        profile: 'trusted',
        allowTools: ['write_file', 'run_command'],
        allow_tools: ['run_command'],
      },
      ctx(),
    );
    const [created] = await listSchedules();
    assert.equal(created?.profile, 'read-only', 'a smuggled profile took effect');
    assert.deepEqual(created?.allowTools, [], 'smuggled allowTools took effect');
  } finally {
    await cleanup(home);
  }
});

/** The cycle-breaker: without it one schedule becomes two, and nobody is watching. */
test('an unattended run cannot create schedules', async () => {
  const home = await tempHome();
  try {
    await assert.rejects(
      () =>
        scheduleTask.run(
          { request: 'and again tomorrow', when: '@daily', why: 'loop' },
          ctx({ unattended: true }),
        ),
      (e: unknown) => isHatsError(e) && /cannot create more schedules/.test((e as Error).message),
    );
    assert.equal((await listSchedules()).length, 0, 'a schedule was created anyway');
  } finally {
    await cleanup(home);
  }
});

test('scheduling the same thing twice does not create two timers', async () => {
  const home = await tempHome();
  try {
    const args = { request: 'check the prices', when: '@daily', why: 'monitoring' };
    await scheduleTask.run(args, ctx());
    const second = await scheduleTask.run({ ...args, when: '@hourly' }, ctx());
    assert.match(second.summary, /Already scheduled/);
    assert.equal((await listSchedules()).length, 1, 'a duplicate timer doubles the spend');
  } finally {
    await cleanup(home);
  }
});

test('a bad expression is a correctable tool error, not a half-made schedule', async () => {
  const home = await tempHome();
  try {
    await assert.rejects(
      () => scheduleTask.run({ request: 'x', when: 'tomorrow morning', why: 'y' }, ctx()),
      (e: unknown) => isHatsError(e),
    );
    assert.equal((await listSchedules()).length, 0);
  } finally {
    await cleanup(home);
  }
});

test('schedule_task is mutating, so an interactive run still asks the human', () => {
  assert.equal(scheduleTask.spec.mutating, true);
  assert.equal(scheduleTask.spec.network, false);
  // No profile or allowTools in the schema at all — absence, not validation.
  const props = Object.keys(scheduleTask.spec.parameters.properties ?? {});
  assert.deepEqual(props.sort(), ['request', 'when', 'why']);
});
