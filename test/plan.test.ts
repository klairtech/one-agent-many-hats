/**
 * The task list, and the gate that reads it.
 *
 * Every other delivery gate compares the answer against what the tools did. This one
 * compares it against what the run said it would do — the only way to catch a piece of work
 * that was never attempted, because an unattempted step leaves no tool call behind to be
 * missing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planTasks, resetTaskLists, taskList, unfinishedTasks, updateTask } from '../src/tools/builtin/plan.js';
import { runVerificationGates } from '../src/engine/gates.js';

const ctx = { runId: 'run_plan_test' } as never;

test('a plan survives being rewritten mid-run', async () => {
  resetTaskLists();
  try {
    await planTasks.run({ tasks: ['read the config', 'summarise caching', 'check the tests'] }, ctx);
    await updateTask.run({ id: 1, state: 'done' }, ctx);

    // Re-planning is normal — the run learned there was a fourth thing. What must not happen
    // is the finished work reverting to todo because the list was replaced.
    await planTasks.run(
      { tasks: ['read the config', 'summarise caching', 'check the tests', 'check the changelog'] },
      ctx,
    );
    const tasks = taskList('run_plan_test');
    assert.equal(tasks.length, 4);
    assert.equal(tasks[0]?.state, 'done', 'completed work was lost when the plan was rewritten');
    assert.equal(tasks[3]?.state, 'todo');
  } finally {
    resetTaskLists();
  }
});

test('dropping a task requires a reason', async () => {
  resetTaskLists();
  try {
    await planTasks.run({ tasks: ['a', 'b'] }, ctx);
    await assert.rejects(updateTask.run({ id: 1, state: 'dropped' }, ctx), /needs a reason/);
    await updateTask.run({ id: 1, state: 'dropped', note: 'no credential for staging' }, ctx);
    assert.equal(taskList('run_plan_test')[0]?.state, 'dropped');
    assert.equal(unfinishedTasks('run_plan_test').length, 1, 'a dropped task is decided, not outstanding');
  } finally {
    resetTaskLists();
  }
});

test('an unknown task id shows the list rather than just failing', async () => {
  resetTaskLists();
  try {
    await planTasks.run({ tasks: ['read the config'] }, ctx);
    await assert.rejects(updateTask.run({ id: 9, state: 'done' }, ctx), /read the config/);
  } finally {
    resetTaskLists();
  }
});

test('delivering with tasks still open is blocked, and dropping them unblocks it', async () => {
  resetTaskLists();
  try {
    await planTasks.run({ tasks: ['count the rules', 'check the staging config'] }, ctx);
    await updateTask.run({ id: 1, state: 'done' }, ctx);

    const input = {
      draft: 'There are 17 rule files.',
      artifacts: [],
      reviewRequired: 'none' as const,
      usedTools: true,
      observations: [],
      runId: 'run_plan_test',
    };

    const blocked = runVerificationGates(input).find((f) => f.gate === 'gates.tasksFinished');
    assert.equal(blocked?.passed, false, 'an unfinished task did not block delivery');
    assert.match(blocked?.detail ?? '', /check the staging config/);

    await updateTask.run({ id: 2, state: 'dropped', note: 'no access to staging from here' }, ctx);
    const after = runVerificationGates(input).find((f) => f.gate === 'gates.tasksFinished');
    assert.equal(after?.passed, true, 'an explicitly dropped task should not block');
  } finally {
    resetTaskLists();
  }
});

test('a run that never planned is never blocked by the plan gate', () => {
  resetTaskLists();
  const findings = runVerificationGates({
    draft: 'There are 17 rule files.',
    artifacts: [],
    reviewRequired: 'none',
    usedTools: true,
    observations: [],
    runId: 'run_with_no_plan',
  });
  assert.equal(findings.find((f) => f.gate === 'gates.tasksFinished')?.passed, true);
});
