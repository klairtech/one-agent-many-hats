/**
 * The failures that are invisible from inside the agent.
 *
 * Each test here corresponds to a specific failure observed across 726 unattended runs,
 * where the fatal errors were clerical rather than cognitive. The agent believed every one
 * of them, which is why the checks compare claims against what the tools actually did
 * rather than against what the model thinks happened.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { completionClaimed, destroyingUnread, editDistanceWithin, nearMiss, stalled } from '../src/engine/vigilance.js';
import type { ToolObservation } from '../src/tools/types.js';

function obs(over: Partial<ToolObservation>): ToolObservation {
  return { callId: 'c', tool: 'read_file', ok: true, summary: '', durationMs: 1, ...over };
}

/** "11 of 12 customers processed, all 144 records complete." */
test('a completeness claim is blocked when tool calls failed', () => {
  const failed = [
    obs({ tool: 'read_file', ok: true, summary: 'customer-01.json' }),
    obs({ tool: 'read_file', ok: false, summary: 'ENOENT customer-12.json', errorCode: 'TOOL_FAILED' }),
  ];

  const bad = completionClaimed('Processed all 144 records for every customer.', failed);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /claims completeness/);
  assert.match(bad.detail, /read_file/);

  // The same claim is fine when nothing failed.
  const clean = completionClaimed('Processed all 144 records for every customer.', [
    obs({ summary: 'ok' }),
  ]);
  assert.equal(clean.ok, true);
});

test('the completion gate does not fire on ordinary prose', () => {
  const withFailure = [obs({ ok: false, errorCode: 'TOOL_FAILED', summary: 'nope' })];
  for (const draft of [
    'The config lives in src/core/config.ts.',
    'I could not reach the API, so this is incomplete.',
    'Two of the three files parsed; the third is malformed.',
  ]) {
    assert.equal(
      completionClaimed(draft, withFailure).ok,
      true,
      `fired on ordinary prose: ${draft}`,
    );
  }
});

/** "A single wrong character in a long file path" — the most common fatal error. */
test('a path one character from an existing sibling is flagged', () => {
  const siblings = ['summary.md', 'customers.csv', 'notes.txt'];
  assert.equal(nearMiss('/ws/reports/sumary.md', siblings), 'summary.md');
  assert.equal(nearMiss('/ws/reports/customer.csv', siblings), 'customers.csv');

  // An intended overwrite is not a typo.
  assert.equal(nearMiss('/ws/reports/summary.md', siblings), null);
  // A genuinely new file is not a typo either.
  assert.equal(nearMiss('/ws/reports/quarterly-review.md', siblings), null);
  // Short names produce too many false positives to be worth flagging.
  assert.equal(nearMiss('/ws/a.md', ['b.md']), null);
});

test('edit distance is bounded and cheap', () => {
  assert.equal(editDistanceWithin('summary', 'sumary', 1), true);
  assert.equal(editDistanceWithin('summary', 'summery', 1), true);
  assert.equal(editDistanceWithin('summary', 'sumry', 1), false);
  assert.equal(editDistanceWithin('report', 'reports', 1), true);
  assert.equal(editDistanceWithin('report', 'invoice', 1), false);
});

/** "Asked to merge two customer folders, one run simply deleted one of them." */
test('destroying something the run never read is refused', () => {
  const readBoth = [
    obs({ tool: 'list_dir', summary: 'customers/acme: 4 files' }),
    obs({ tool: 'read_file', summary: 'customers/acme/notes.txt' }),
  ];
  assert.equal(destroyingUnread('customers/acme', readBoth).ok, true);

  const readNeither = [obs({ tool: 'list_dir', summary: 'customers/globex: 2 files' })];
  const check = destroyingUnread('customers/acme', readNeither);
  assert.equal(check.ok, false);
  assert.match(check.detail, /nothing in this run read/);
  assert.match(check.detail, /ambiguous/);

  // A failed read does not count as having looked.
  const failedRead = [obs({ tool: 'read_file', ok: false, summary: 'customers/acme/notes.txt' })];
  assert.equal(destroyingUnread('customers/acme', failedRead).ok, false);
});

/** "It changes plans only after it hits a wall — never after it sees the sign." */
test('a run that is going in circles is noticed early', () => {
  const failing = Array.from({ length: 4 }, () =>
    obs({ tool: 'fetch_url', ok: false, summary: 'HTTP 500', errorCode: 'TOOL_FAILED' }),
  );
  const a = stalled(failing);
  assert.equal(a.stalled, true);
  assert.match(a.reason, /all failed/);

  const identical = Array.from({ length: 4 }, () =>
    obs({ tool: 'search_files', summary: 'no matches for /widget/ in 113 files' }),
  );
  const b = stalled(identical);
  assert.equal(b.stalled, true);
  assert.match(b.reason, /identical/);

  // Ordinary progress is not a stall.
  const progressing = [
    obs({ tool: 'list_dir', summary: '3 files' }),
    obs({ tool: 'read_file', summary: 'a.ts' }),
    obs({ tool: 'read_file', summary: 'b.ts' }),
    obs({ tool: 'derive_metric', summary: 'total 57.75' }),
  ];
  assert.equal(stalled(progressing).stalled, false);

  // And too little evidence is not a stall either.
  assert.equal(stalled(failing.slice(0, 2)).stalled, false);
});
