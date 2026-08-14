/**
 * Full-loop tests through the scripted provider: composition, tool execution, the review
 * hat, the delivery gate and its bounded recovery — with no network and no GPU.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { workspaceSlug } from '../src/core/paths.js';
import { runAgent, advanceStage } from '../src/engine/run.js';
import { knownEnforcementPoints } from '../src/engine/gates.js';
import { MemoryLayers } from '../src/memory/index.js';
import { ProviderPool, type MockTurn } from '../src/providers/index.js';
import { Registry } from '../src/registry/loader.js';
import { cleanup, tempHome, tempWorkspace, testConfig } from './helpers.js';

async function harness(script: MockTurn[], files: Record<string, string> = {}) {
  const home = await tempHome();
  const ws = await tempWorkspace({
    'src/alpha.ts': 'export const a = 1;\n',
    'src/beta.ts': 'export const b = 2;\n'.repeat(20),
    ...files,
  });
  const config = testConfig();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const pool = ProviderPool.withMock(config, script, 'mock');
  const memory = new MemoryLayers(workspaceSlug(ws), config, pool);
  return { home, ws, config, registry, pool, memory };
}

test('a full run: tool call, observation, review hat, delivery', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: 'Looking.', toolCalls: [{ name: 'list_dir', args: { path: 'src' } }] },
    { text: 'There are 2 TypeScript files under src: alpha.ts and beta.ts.' },
    { text: 'PASS — every claim traces to the listing.' },
  ]);

  const result = await runAgent({
    request: 'what is in src?',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
  });

  assert.equal(result.ok, true);
  assert.match(result.answer, /alpha\.ts/);
  assert.equal(result.outcomeId, 'outcome/answer');
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0]?.tool, 'list_dir');
  assert.equal(result.observations[0]?.ok, true);
  assert.ok(result.artifactCount >= 1, 'the listing must be stored as an artifact');
  assert.ok(result.gateFindings.every((g) => g.passed), JSON.stringify(result.gateFindings));
  await cleanup(home, ws);
});

test('a fabricated number blocks delivery once, then the corrected answer ships', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: 'Looking.', toolCalls: [{ name: 'list_dir', args: { path: 'src' } }] },
    { text: 'src holds 4096 TypeScript files.' },
    { text: 'PASS' },
    { text: 'src holds 2 TypeScript files: alpha.ts and beta.ts.' },
    { text: 'PASS' },
  ]);

  const result = await runAgent({
    request: 'how many files in src?',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
  });

  assert.ok(!result.answer.includes('4096'), 'the fabricated count must not survive');
  assert.match(result.answer, /alpha\.ts/);
  await cleanup(home, ws);
});

test('when the correction also fails, the answer ships with the gap disclosed', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: 'Looking.', toolCalls: [{ name: 'list_dir', args: { path: 'src' } }] },
    { text: 'src holds 4096 files.' },
    { text: 'PASS' },
    { text: 'src still holds 4096 files.' },
    { text: 'PASS' },
  ]);

  const result = await runAgent({
    request: 'how many files in src?',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
  });

  assert.match(result.answer, /Unverified in this answer/);
  assert.match(result.answer, /rule\/no-invented-numbers/);
  await cleanup(home, ws);
});

test('a guardian FAIL sends the run back and the corrected draft is reviewed again', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: 'Looking.', toolCalls: [{ name: 'list_dir', args: { path: 'src' } }] },
    { text: 'src contains alpha.ts and beta.ts.' },
    { text: 'FAIL — the answer does not say which is larger, which was asked.' },
    { text: 'src contains alpha.ts and beta.ts; beta.ts is the larger of the two.' },
    { text: 'PASS' },
  ]);

  const result = await runAgent({
    request: 'what is in src and which file is larger?',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
  });

  assert.equal(result.ok, true);
  assert.match(result.answer, /larger/);
  // A stale FAIL must not block the corrected draft forever.
  assert.ok(result.gateFindings.every((g) => g.passed), JSON.stringify(result.gateFindings));
  await cleanup(home, ws);
});

test('a write attempt under read-only is denied inside the run and the model is told why', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: 'Editing.', toolCalls: [{ name: 'write_file', args: { path: 'x.txt', content: 'hi' } }] },
    { text: 'I cannot modify files in this profile, so here is the change as text.' },
    { text: 'PASS' },
  ]);

  const result = await runAgent({
    request: 'add a file',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
    profile: 'read-only',
  });

  const denial = result.observations[0];
  assert.equal(denial?.ok, false);
  assert.match(denial?.summary ?? '', /DENIED/);
  assert.ok(
    denial?.ruleId === 'rule/allowlist-intersection' ||
      denial?.ruleId === 'rule/profile-not-model-selectable',
    `unexpected rule: ${denial?.ruleId}`,
  );
  await cleanup(home, ws);
});

test('an empty model turn is nudged rather than delivered', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: '' },
    { text: 'The workspace has two TypeScript files.' },
    { text: 'PASS' },
  ]);

  const result = await runAgent({
    request: 'describe the workspace',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
  });

  assert.match(result.answer, /two TypeScript files/);
  await cleanup(home, ws);
});

test('the run record captures which skill versions were loaded', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    { text: 'Two files.' },
    { text: 'PASS' },
  ]);
  const result = await runAgent({
    request: 'hello',
    workspaceRoot: ws,
    config,
    registry,
    pool,
    memory,
  });

  const { readJson } = await import('../src/core/store.js');
  const path = await import('node:path');
  const record = await readJson<Record<string, unknown>>(
    path.join(result.runDir, 'run.json'),
    {} as Record<string, unknown>,
  );
  const versions = record['skillVersions'] as Record<string, number>;
  assert.ok(
    (versions['core/discipline'] ?? 0) >= 1,
    'the discipline skill and its version must be recorded',
  );
  assert.ok((record['ruleVersions'] as object) && Object.keys(record['ruleVersions'] as object).length > 5);
  assert.ok(Array.isArray(record['allowlist']));
  await cleanup(home, ws);
});

test('stage advancement follows the declared order', () => {
  const base = { usedTools: true, discoveryCount: 0, hasPlanStage: true, planned: false };
  assert.equal(advanceStage('intake', base), 'discover');
  assert.equal(advanceStage('discover', { ...base, discoveryCount: 1 }), 'plan');
  assert.equal(advanceStage('discover', { ...base, discoveryCount: 1, planned: true }), 'act');
  assert.equal(advanceStage('plan', base), 'act');
  assert.equal(advanceStage('act', { ...base, usedTools: false }), 'verify');
  assert.equal(advanceStage('verify', base), 'act', 'a blocked gate sends the run back to act');
});

/**
 * A review that fails once, then passes, must deliver the draft — not the verdict that
 * approved it. Regression for a live scheduled run that answered "PASS. The draft is ready
 * to deliver" instead of the report. The helper is internal, so this drives it through the
 * one visible symptom: a verdict-shaped string is never the answer.
 */
test('a verdict is never mistaken for the draft', async () => {
  const { looksLikeVerdictForTest } = await import('../src/engine/run.js');
  for (const verdict of ['PASS', '**PASS**', '  FAIL.', '**REVISE**', 'DELIVER:', '## PASS']) {
    assert.equal(looksLikeVerdictForTest(verdict), true, `missed a verdict: ${verdict}`);
  }
  for (const answer of [
    'The total is $57.75.',
    'PASS rates improved by 3% this quarter.',
    '**Total: $57.75** — the write was blocked, so nothing was saved.',
    'All checks PASS.',
  ]) {
    assert.equal(looksLikeVerdictForTest(answer), false, `treated an answer as a verdict: ${answer}`);
  }
});

/**
 * Every tool_use must get a tool_result, including calls dropped by the per-step limit.
 * Anthropic rejects the whole next request otherwise — "tool_use ids were found without
 * tool_result blocks" — and the run dies with nothing delivered. Seen in a live panel run.
 */
test('tool calls over the per-step limit still get an answer', async () => {
  const { home, ws, config, registry, pool, memory } = await harness([
    // Six calls in one step, against a limit of two.
    {
      text: '',
      toolCalls: Array.from({ length: 6 }, () => ({ name: 'list_dir', args: { path: 'src' } })),
    },
    { text: 'There are 2 TypeScript files under src.' },
    { text: 'PASS' },
  ]);
  config.limits.maxToolCallsPerStep = 2;

  try {
    const result = await runAgent({
      request: 'list things',
      workspaceRoot: ws,
      config,
      registry,
      pool,
      memory,
    });

    const assistantTurn = result.messages.find((m) => m.role === 'assistant' && m.toolCalls?.length);
    assert.equal(assistantTurn?.toolCalls?.length, 6, 'the assistant turn should hold all six');
    const answered = new Set(
      result.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId),
    );
    for (const call of assistantTurn?.toolCalls ?? []) {
      assert.ok(answered.has(call.id), `tool_use ${call.id} was left without a tool_result`);
    }
    // The four beyond the limit are answered with a refusal, not silence.
    const declined = result.messages.filter(
      (m) => m.role === 'tool' && /Not run: you requested/.test(m.content),
    );
    assert.equal(declined.length, 4);
  } finally {
    await cleanup(home, ws);
  }
});
