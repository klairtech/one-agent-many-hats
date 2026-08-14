/**
 * ADR-0006. The property that matters: no autonomy level promotes a tool.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runAutoPromotion } from '../src/engine/autonomy.js';
import { listProposals, stageProposal } from '../src/registry/proposals.js';
import { Registry, syncPacks } from '../src/registry/loader.js';
import { knownEnforcementPoints } from '../src/engine/gates.js';
import { cleanup, tempHome, testConfig } from './helpers.js';
import { quote, type CatalogueEntry } from '../src/ui/pricing.js';

const SKILL = [
  '---',
  'id: outcome/tidy',
  'kind: outcome',
  'version: 1',
  'description: Tidy something up.',
  'tools:',
  '  - list_dir',
  '  - read_file',
  'stages: [intake, act, deliver]',
  'review: none',
  '---',
  '',
  '# Tidy',
  '',
  'Do the small thing well.',
].join('\n');

async function stage(kind: 'skill' | 'rule' | 'tool', title: string, times: number) {
  for (let i = 0; i < times; i++) {
    await stageProposal({
      kind,
      title,
      rationale: 'recurred',
      evidence: [`run:${i}`],
      content: SKILL,
      createdByRun: `run:${i}`,
    });
  }
}

test('supervised promotes nothing', async () => {
  const home = await tempHome();
  await syncPacks();
  await stage('skill', 'tidy skill', 5);

  const result = await runAutoPromotion(testConfig());
  assert.equal(result.promoted.length, 0);
  assert.equal(result.waiting.length, 1);
  await cleanup(home);
});

test('adaptive promotes a skill once it has recurred enough, and announces it', async () => {
  const home = await tempHome();
  await syncPacks();
  await stage('skill', 'tidy skill', 3);

  const config = testConfig();
  config.autonomy = { level: 'adaptive', promoteAfterOccurrences: 3, announce: true };

  const result = await runAutoPromotion(config);
  assert.equal(result.promoted.length, 1);
  assert.equal(result.promoted[0]?.proposal.kind, 'skill');

  // It is genuinely live afterwards, and versioned.
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  assert.ok(registry.find('outcome/tidy'), 'the promoted skill must load');

  const after = await listProposals();
  assert.equal(after.find((p) => p.kind === 'skill')?.status, 'promoted');
  await cleanup(home);
});

test('adaptive waits while the evidence is thin', async () => {
  const home = await tempHome();
  await syncPacks();
  await stage('skill', 'tidy skill', 1);

  const config = testConfig();
  config.autonomy = { level: 'adaptive', promoteAfterOccurrences: 3, announce: true };

  const result = await runAutoPromotion(config);
  assert.equal(result.promoted.length, 0);
  assert.equal(result.waiting[0]?.needs, 2);
  await cleanup(home);
});

test('no autonomy level ever promotes a tool', async () => {
  const home = await tempHome();
  await syncPacks();
  await stage('tool', 'a shiny new capability', 50);

  const config = testConfig();
  config.autonomy = { level: 'adaptive', promoteAfterOccurrences: 1, announce: true };

  const result = await runAutoPromotion(config);
  assert.equal(result.promoted.length, 0, 'a tool must never auto-promote');
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0]?.kind, 'tool');
  await cleanup(home);
});

// --- pricing ------------------------------------------------------------------------

const CATALOGUE: CatalogueEntry[] = [
  { id: 'anthropic/claude-opus-4-6', promptPerM: 15, completionPerM: 75, contextLength: 200000 },
  { id: 'openai/gpt-5', promptPerM: 1.25, completionPerM: 10 },
  { id: 'deepseek/deepseek-chat', promptPerM: 0.27, completionPerM: 1.1 },
];

test('OpenRouter prices are exact for OpenRouter and a cross-reference elsewhere', () => {
  const direct = quote(CATALOGUE, 'openrouter', 'openai/gpt-5');
  assert.equal(direct?.basis, 'exact');
  assert.equal(direct?.promptPerM, 1.25);

  const indirect = quote(CATALOGUE, 'anthropic', 'claude-opus-4-6');
  assert.equal(indirect?.basis, 'cross-reference');
  assert.equal(indirect?.completionPerM, 75);
  assert.equal(indirect?.matchedId, 'anthropic/claude-opus-4-6');
});

test('local providers get no price rather than a wrong one', () => {
  assert.equal(quote(CATALOGUE, 'ollama', 'qwen2.5:7b'), null);
  assert.equal(quote(CATALOGUE, 'lmstudio', 'anything'), null);
});

test('an unknown model returns nothing rather than a guess', () => {
  assert.equal(quote(CATALOGUE, 'openai', 'gpt-does-not-exist'), null);
});
