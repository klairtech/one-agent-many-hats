import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllowlist, route, routeTier, selectHat } from '../src/engine/compose.js';
import { knownEnforcementPoints } from '../src/engine/gates.js';
import { Registry } from '../src/registry/loader.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { cleanup, tempHome, testConfig } from './helpers.js';

test('routing is deterministic and falls back to the answer skill', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });

  assert.equal(route('what does this project do?', registry, 'read-only').outcomeId, 'outcome/answer');
  assert.equal(
    route('why does the loop retry twice?', registry, 'read-only').outcomeId,
    'outcome/investigate',
  );
  assert.equal(route('fix the typo in the README', registry, 'assisted').outcomeId, 'outcome/change');

  // A change request under read-only routes to answer, not to a skill whose tools are absent.
  const denied = route('fix the typo in the README', registry, 'read-only');
  assert.equal(denied.outcomeId, 'outcome/answer');
  assert.match(denied.reason, /read-only/);
  await cleanup(home);
});

test('hat triggers match whole words, not substrings', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });

  // Regression: "TypeScript" contains "script", which put the coder's hat on and — because
  // the coder hat used to narrow the allowlist — deleted the file tools from step 1.
  const wrong = selectHat(registry, {
    stage: 'intake',
    step: 1,
    request: 'How many TypeScript files are in src?',
    lastText: '',
    lastToolNames: [],
    exhausted: false,
    multiStep: false,
  });
  assert.notEqual(wrong.skill?.role, 'coder');

  const right = selectHat(registry, {
    stage: 'act',
    step: 1,
    request: 'compute the weighted average of those sizes',
    lastText: '',
    lastToolNames: [],
    exhausted: false,
    multiStep: false,
  });
  assert.equal(right.skill?.role, 'coder');
  await cleanup(home);
});

test('a word in the request does not wear the same hat for the whole run', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });

  // A live run put "Security review of this codebase…" in the request, and the critic's
  // playbook was injected into all fourteen steps because the request never changes.
  const opening = selectHat(registry, {
    stage: 'act',
    step: 1,
    request: 'Security review of this codebase. Where does it handle external input?',
    lastText: '',
    lastToolNames: [],
    exhausted: false,
    multiStep: false,
  });
  assert.equal(opening.skill?.role, 'critic', 'the opening steps may still read the request');

  const later = selectHat(registry, {
    stage: 'act',
    step: 8,
    request: 'Security review of this codebase. Where does it handle external input?',
    lastText: 'I read src/core/paths.ts and found the guard.',
    lastToolNames: ['read_file'],
    exhausted: false,
    multiStep: false,
  });
  assert.notEqual(later.skill?.role, 'critic', 'by step 8 the hat follows what is happening now');

  // Recent context still selects a hat when it genuinely calls for one.
  const computing = selectHat(registry, {
    stage: 'act',
    step: 8,
    request: 'Security review of this codebase.',
    lastText: 'Now I need to calculate the totals across those files.',
    lastToolNames: [],
    exhausted: false,
    multiStep: false,
  });
  assert.equal(computing.skill?.role, 'coder');
  await cleanup(home);
});

test('deterministic hats beat keyword hats', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });

  const exhausted = selectHat(registry, {
    stage: 'act',
    step: 20,
    request: 'plan the review of this compute',
    lastText: '',
    lastToolNames: [],
    exhausted: true,
    multiStep: true,
  });
  assert.equal(exhausted.skill?.role, 'reflector');

  const review = selectHat(registry, {
    stage: 'verify',
    step: 5,
    request: 'anything',
    lastText: '',
    lastToolNames: [],
    exhausted: false,
    reviewPass: 'guardian',
    multiStep: false,
  });
  assert.equal(review.skill?.role, 'guardian');
  await cleanup(home);
});

test('the allowlist is an intersection: profile and network can only remove', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const change = registry.skill('outcome/change');
  const config = testConfig();

  const readOnly = buildAllowlist(change, ALL_TOOLS, config, 'read-only');
  assert.ok(!readOnly.allowlist.has('write_file'));
  assert.ok(!readOnly.allowlist.has('run_command'));
  assert.ok(readOnly.allowlist.has('read_file'));
  assert.ok(readOnly.dropped.some((d) => d.tool === 'write_file' && /assisted/.test(d.why)));

  const assisted = buildAllowlist(change, ALL_TOOLS, config, 'assisted');
  assert.ok(assisted.allowlist.has('write_file'));

  // A skill cannot grant what the platform does not have.
  const invented = { ...change, tools: [...change.tools, 'delete_everything'] };
  const dropped = buildAllowlist(invented, ALL_TOOLS, config, 'trusted');
  assert.ok(!dropped.allowlist.has('delete_everything'));
  await cleanup(home);
});

test('only review hats may narrow the allowlist', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const answer = registry.skill('outcome/answer');
  const config = testConfig();
  const guardian = registry.behavioural().find((s) => s.role === 'guardian');
  const coder = registry.behavioural().find((s) => s.role === 'coder');

  const underGuardian = buildAllowlist(answer, ALL_TOOLS, config, 'read-only', guardian, true);
  assert.ok(!underGuardian.allowlist.has('search_files'), 'guardian narrows to validation tools');

  const underCoder = buildAllowlist(answer, ALL_TOOLS, config, 'read-only', coder, true);
  assert.ok(underCoder.allowlist.has('search_files'), 'a work hat must not delete the run’s tools');

  // Same guardian, but chosen by keyword during work rather than by the review rule.
  const keywordGuardian = buildAllowlist(answer, ALL_TOOLS, config, 'read-only', guardian, false);
  assert.ok(
    keywordGuardian.allowlist.has('search_files'),
    'a keyword-selected review hat must not delete the run’s tools mid-work',
  );
  await cleanup(home);
});

test('tier routing sends judgement work up and downgrades under context pressure', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const answer = registry.skill('outcome/answer');

  assert.equal(
    routeTier({ stage: 'deliver', outcome: answer, contextChars: 100, budgetChars: 100_000 }).tier,
    'frontier',
  );
  assert.equal(
    routeTier({ stage: 'discover', outcome: answer, contextChars: 100, budgetChars: 100_000 }).tier,
    'standard',
  );
  assert.equal(
    routeTier({ stage: 'deliver', outcome: answer, contextChars: 99_000, budgetChars: 100_000 }).tier,
    'light',
  );
  await cleanup(home);
});

/**
 * A promoted skill has to be reachable, or self-extension produces capability that can
 * never be used. Regression for a mined skill that sat in the live registry while every
 * matching request routed past it to outcome/answer. Written as a real skill file so the
 * frontmatter parsing of `triggers` is exercised too.
 */
test('an outcome skill can claim requests by declaring triggers', async () => {
  const home = await tempHome();
  try {
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    // Load once so the pack skills are bootstrapped into the temp home.
    await Registry.load({ knownGates: knownEnforcementPoints() });
    await fsp.writeFile(
      path.join(home, 'registry', 'skills', 'outcome-incident-triage.md'),
      [
        '---',
        'id: outcome/incident-triage',
        'kind: outcome',
        'version: 1',
        'description: Triage incidents by service.',
        'triggers:',
        '  - incident',
        '  - downtime',
        '  - severity',
        'tools:',
        '  - list_dir',
        '  - read_file',
        'stages:',
        '  - intake',
        '  - act',
        '  - deliver',
        'review: guardian',
        '---',
        '',
        '# Incident triage',
        '',
        'Steps.',
      ].join('\n'),
      'utf8',
    );
    const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
    assert.ok(registry.find('outcome/incident-triage'), 'the skill did not load');

    const hit = route('Triage the incidents and tell me total downtime', registry, 'read-only');
    assert.equal(hit.outcomeId, 'outcome/incident-triage', hit.reason);

    // One shared word must not be enough, or a common trigger hijacks every request.
    const weak = route('what is the downtime policy', registry, 'read-only');
    assert.equal(weak.outcomeId, 'outcome/answer', weak.reason);

    // Built-in intents keep priority over a custom skill's vocabulary.
    const change = route('fix the incident handler and update the severity map', registry, 'assisted');
    assert.equal(change.outcomeId, 'outcome/change', change.reason);
  } finally {
    await cleanup(home);
  }
});
