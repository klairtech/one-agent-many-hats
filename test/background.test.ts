/**
 * Commands that outlive the step that started them.
 *
 * The interesting case is not that a background command runs — it is that starting one
 * *succeeds*, immediately, and therefore looks exactly like the work having been done. The
 * gate is the point of this file; the plumbing is checked so the gate has something real to
 * be right about.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { commandOutput, resetBackgroundJobs, startBackgroundCommand, stopCommand } from '../src/tools/builtin/background.js';
import { startedButNeverRead } from '../src/engine/vigilance.js';
import type { ToolObservation } from '../src/tools/types.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

const ctx = { config: DEFAULT_CONFIG, workspaceRoot: process.cwd(), runId: 'run_test' } as never;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function obs(over: Partial<ToolObservation>): ToolObservation {
  return { callId: 'c', tool: 'run_command', ok: true, summary: '', durationMs: 1, ...over };
}

test('a background command keeps producing output after the call that started it returned', async () => {
  try {
    const job = startBackgroundCommand('printf one; sleep 0.6; printf two', process.cwd(), 'run_test');

    // The whole point: the start returned, and the work has not finished. Settle first so
    // the assertion is about the job still running rather than about the shell not having
    // flushed yet — an unflushed pipe would make the next read look like a fresh one.
    await settle(300);
    const first = await commandOutput.run({ id: job.id }, ctx);
    assert.equal((first.payload as { running: boolean }).running, true, 'it should still be running');
    assert.equal((first.payload as { stdout: string }).stdout, 'one', 'the first read should have the first write');

    await settle(900);
    const second = await commandOutput.run({ id: job.id }, ctx);
    const payload = second.payload as { running: boolean; stdout: string };
    assert.equal(payload.running, false, 'it should have finished');
    // Only what is new: "one" was already handed over on the first read.
    assert.equal(payload.stdout, 'two', `the second read should return only what is new, got ${payload.stdout}`);

    const all = await commandOutput.run({ id: job.id, from_start: true }, ctx);
    assert.equal((all.payload as { stdout: string }).stdout, 'onetwo');
  } finally {
    resetBackgroundJobs();
  }
});

test('a non-zero exit is a failure, but still running is not', async () => {
  try {
    const job = startBackgroundCommand('exit 3', process.cwd(), 'run_test');
    const slow = startBackgroundCommand('sleep 5', process.cwd(), 'run_test');
    await settle(400);
    assert.equal((await commandOutput.run({ id: job.id }, ctx)).failed, true, 'exit 3 should be a failure');
    assert.notEqual((await commandOutput.run({ id: slow.id }, ctx)).failed, true, 'still running is not a failure');
  } finally {
    resetBackgroundJobs();
  }
});

test('a server that would run forever can be stopped', async () => {
  try {
    // A shell that forks is the case that matters: killing the shell alone leaves the
    // sleep running, which is exactly what a dev server does to a port.
    const job = startBackgroundCommand('sleep 30 & wait', process.cwd(), 'run_test');
    await settle(300);
    await stopCommand.run({ id: job.id }, ctx);

    // Polled rather than slept: SIGTERM is a request, the SIGKILL fallback is 1.5s behind
    // it, and a fixed wait either flakes on a loaded machine or pads every run.
    let running = true;
    for (let i = 0; i < 40 && running; i++) {
      await settle(100);
      running = ((await commandOutput.run({ id: job.id }, ctx)).payload as { running: boolean }).running;
    }
    assert.equal(running, false, 'stop_command did not stop it within 4s');
  } finally {
    resetBackgroundJobs();
  }
});

test('an unknown id says what is actually running', async () => {
  try {
    const job = startBackgroundCommand('sleep 5', process.cwd(), 'run_test');
    await assert.rejects(commandOutput.run({ id: 'job_nope' }, ctx), new RegExp(job.id));
  } finally {
    resetBackgroundJobs();
  }
});

/**
 * The gate. Every other check in vigilance.ts examines a call that failed; this one
 * examines a call that succeeded, because "started" and "finished" are the same shape.
 */
test('reporting on a background command you never read is blocked', () => {
  const started = obs({ summary: 'started job_abc in the background: npm test' });

  const blocked = startedButNeverRead('The test suite passes: 248 of 248.', [started]);
  assert.equal(blocked.ok, false, 'a claim about an unread job should be blocked');

  const read = startedButNeverRead('The test suite passes: 248 of 248.', [
    started,
    obs({ tool: 'command_output', summary: 'job_abc — exited 0' }),
  ]);
  assert.equal(read.ok, true, 'having read it, the claim is allowed');

  // Started, but the answer is about something else entirely. Nobody was misled.
  assert.equal(
    startedButNeverRead('There are 17 rule files under packs/rules.', [started]).ok,
    true,
    'an answer that does not lean on the job should not be blocked',
  );

  // A command that actually ran to completion is not a background job at all.
  assert.equal(
    startedButNeverRead('The test suite passes.', [obs({ summary: 'exit 0\n248 passed' })]).ok,
    true,
    'a foreground command should never trip this gate',
  );
});
