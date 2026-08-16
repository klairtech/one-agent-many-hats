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

import { askedInProse, completionClaimed, destroyingUnread, editDistanceWithin, nearMiss, promisedFileNotWritten, stalled } from '../src/engine/vigilance.js';
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

/**
 * The live failure this was written for: the agent worked out it needed AWS credentials,
 * said so in its closing paragraph, and ended the run. ask_user sat in the allowlist for
 * all four steps. Prompt guidance did not fix it — the realisation arrives while the agent
 * is composing prose rather than choosing a tool.
 */
test('asking for a credential in the final answer is blocked while ask_user went unused', () => {
  const draft = [
    'I cannot answer because the data lives in AWS Athena, outside this workspace.',
    'To proceed, please provide:',
    '- AWS Region',
    '- AWS Access Key ID and Secret Access Key',
  ].join('\n');

  const check = askedInProse(draft, [obs({ tool: 'read_file' })], true);
  assert.equal(check.ok, false);
  assert.match(check.detail, /never called/);
});

test('an agent that did ask, or could not ask, is reporting a fact rather than skipping a step', () => {
  const draft = 'To proceed, please provide your AWS access key and region.';

  // It asked and the human declined. That is an answer, not an omission.
  assert.equal(askedInProse(draft, [obs({ tool: 'ask_user' })], true).ok, true);

  // The skill never granted the tool. Describing the limit is all it can do.
  assert.equal(askedInProse(draft, [obs({})], false).ok, true);
});

test('ordinary answers do not trip it', () => {
  const ok = (draft: string) => askedInProse(draft, [obs({})], true).ok;

  // No request for input at all.
  assert.equal(ok('The endpoint is configured in src/config.ts (art_1).'), true);
  // A request, but for something that is not a connection.
  assert.equal(ok('Please provide the month you want reported, in YYYY-MM format.'), true);
  // Connection vocabulary, but nothing is being asked of the human.
  assert.equal(ok('The credentials are read from the AWS profile named "prod" (art_2).'), true);
  // Reporting a refusal it already hit.
  assert.equal(ok('The access key in the environment is expired, so the query failed.'), true);
});

/**
 * The live failure: a research run computed a fundraising strategy in the sandbox and
 * closed with "three detailed strategy artifacts are ready for download". No file was
 * written, and the skill had no write_file to write one with — so the reader went looking
 * for a document that was never going to exist. An artifact is evidence inside the run
 * record; a file is a thing on disk. The words are close enough to swap without noticing.
 */
test('promising a downloadable file while writing none is blocked', () => {
  const draft =
    'The strategy is set out above.\nThree detailed strategy artifacts are ready for download.';
  const check = promisedFileNotWritten(draft, [obs({ tool: 'sandbox_run' }), obs({ tool: 'web_search' })]);
  assert.equal(check.ok, false);
  assert.match(check.detail, /nothing was\s+written/);
});

test('a run that really wrote a file may say so', () => {
  const draft = 'I have written the report to reports/strategy.md.';
  assert.equal(promisedFileNotWritten(draft, [obs({ tool: 'write_file', ok: true })]).ok, true);
  assert.equal(promisedFileNotWritten(draft, [obs({ tool: 'apply_patch', ok: true })]).ok, true);
});

test('the honest close is exactly what the gate is trying to produce', () => {
  // The sentence one edit away from the blocked one has to pass, or the gate teaches
  // nothing and just annoys.
  for (const honest of [
    'The strategy is below. No file was written — the content is in this answer.',
    'Nothing was written to disk; copy the outline from above.',
    'Here is the plan, with the numbers cited to their artifacts.',
  ]) {
    assert.equal(promisedFileNotWritten(honest, [obs({ tool: 'sandbox_run' })]).ok, true, honest);
  }
});

/**
 * A failure the run recovered from is the recovery loop working, not an incomplete job.
 *
 * Live: a run wrote a sandbox snippet, hit an unbound artifact, fixed it, hit a wrong type,
 * fixed that, got its answer on the third attempt — and was told the answer was unverified
 * because two calls had failed along the way. The gate fired on its own success.
 */
test('a tool that failed and then succeeded does not count against completeness', () => {
  const draft = 'Exhaustive searches across src/ return no matches across all 102 files.';
  const recovered = [
    obs({ tool: 'sandbox_run', ok: false }),
    obs({ tool: 'sandbox_run', ok: false }),
    obs({ tool: 'sandbox_run', ok: true }),
  ];
  assert.equal(completionClaimed(draft, recovered).ok, true, 'recovered failures still blocked');

  // A failure with nothing after it is still a failure, which is the whole point.
  const stuck = [obs({ tool: 'sandbox_run', ok: true }), obs({ tool: 'search_files', ok: false })];
  assert.equal(completionClaimed(draft, stuck).ok, false, 'an unrecovered failure was let through');

  // And recovery is per tool: another tool succeeding proves nothing about this one.
  const wrongTool = [obs({ tool: 'search_files', ok: false }), obs({ tool: 'read_file', ok: true })];
  assert.equal(completionClaimed(draft, wrongTool).ok, false, 'a different tool cleared the failure');
});
