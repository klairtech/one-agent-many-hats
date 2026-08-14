import assert from 'node:assert/strict';
import test from 'node:test';

import { knownEnforcementPoints, ENFORCEMENT_POINTS } from '../src/engine/gates.js';
import { parseRule, parseSkill, Registry } from '../src/registry/loader.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { cleanup, tempHome } from './helpers.js';

test('the shipped pack loads and every rule names a real enforcement point', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });

  assert.ok(registry.skills.length >= 10, `only ${registry.skills.length} skills loaded`);
  assert.ok(registry.rules.length >= 10, `only ${registry.rules.length} rules loaded`);
  assert.ok(registry.find('core/discipline'), 'the always-loaded discipline skill must exist');
  assert.ok(registry.find('outcome/answer'));

  for (const rule of registry.rules) {
    if (rule.strength === 'prompt') continue;
    assert.ok(
      rule.enforcedBy && ENFORCEMENT_POINTS[rule.enforcedBy],
      `${rule.id} names "${rule.enforcedBy}" which does not exist`,
    );
  }
  await cleanup(home);
});

test('every tool a shipped skill lists exists, and every pattern is a legal one', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const platform = new Set(ALL_TOOLS.map((t) => t.spec.name));

  for (const skill of registry.skills) {
    for (const tool of skill.tools) {
      if (tool.includes('*')) {
        // Patterns exist for MCP, whose tool names are unknown until a server connects.
        // A pattern must still be anchored to a namespace, or a skill could silently
        // acquire everything the platform grows later.
        assert.ok(
          tool.startsWith('mcp__'),
          `${skill.id} uses the wildcard "${tool}" outside the mcp__ namespace`,
        );
        continue;
      }
      assert.ok(platform.has(tool), `${skill.id} lists unknown tool "${tool}"`);
    }
  }
  await cleanup(home);
});

test('every behavioural skill declares a role and every hat role is unique', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const roles = new Set<string>();
  for (const skill of registry.behavioural()) {
    assert.ok(skill.role, `${skill.id} is behavioural but declares no role`);
    assert.ok(!roles.has(skill.role!), `two skills claim the ${skill.role} hat`);
    roles.add(skill.role!);
  }
  assert.ok(roles.has('guardian') && roles.has('planner') && roles.has('communicator'));
  await cleanup(home);
});

test('shipped skills and rules only reference stages the engine actually has', async () => {
  const home = await tempHome();
  const { STAGES } = await import('../src/engine/compose.js');
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const known = new Set<string>([...STAGES]);

  for (const skill of registry.skills) {
    for (const stage of skill.stages) {
      assert.ok(known.has(stage), `${skill.id} declares unknown stage "${stage}"`);
    }
  }
  // A rule may also scope to a tool name, so only stage-looking tokens are checked.
  const toolish = new Set(ALL_TOOLS.map((t) => t.spec.name));
  const profiles = new Set(['read-only', 'assisted', 'trusted']);
  for (const rule of registry.rules) {
    for (const scope of rule.scope) {
      assert.ok(
        known.has(scope) || toolish.has(scope) || profiles.has(scope),
        `${rule.id} scopes to "${scope}", which is not a stage, a tool or a profile`,
      );
    }
  }
  await cleanup(home);
});

test('a rule above prompt strength must name an enforcement point', () => {
  assert.throws(
    () =>
      parseRule(
        ['---', 'id: rule/x', 'statement: something', 'strength: gate', '---', 'body'].join('\n'),
        'test',
      ),
    /names no enforced_by/,
  );
});

test('a behavioural skill without a role is refused', () => {
  assert.throws(
    () => parseSkill(['---', 'id: b/x', 'kind: behavioural', '---', 'body'].join('\n'), 'test'),
    /must declare a role/,
  );
});

test('the loader refuses a gate rule pointing at a check that does not exist', async () => {
  const home = await tempHome();
  const { syncPacks } = await import('../src/registry/loader.js');
  const { registryDir } = await import('../src/core/paths.js');
  const { writeTextAtomic } = await import('../src/core/store.js');
  const path = await import('node:path');

  await syncPacks();
  await writeTextAtomic(
    path.join(registryDir(), 'rules', 'bogus.md'),
    [
      '---',
      'id: rule/bogus',
      'statement: something important',
      'strength: gate',
      'enforced_by: nowhere.at.all',
      '---',
      'body',
    ].join('\n'),
  );

  await assert.rejects(
    Registry.load({ knownGates: knownEnforcementPoints() }),
    /not a registered enforcement point/,
  );
  await cleanup(home);
});

/**
 * mergeConfig enumerates every section by name, so a new one is silently dropped unless it
 * is added there too — which is exactly what happened to `channels`, leaving a configured
 * channel invisible with no error anywhere. This asserts every declared section survives a
 * round trip rather than testing the one that broke.
 */
test('every config section survives a save/load round trip', async () => {
  const home = await tempHome();
  try {
    const { loadConfig, saveConfig, DEFAULT_CONFIG } = await import('../src/core/config.js');
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.channels = { files: { kind: 'local', allowFrom: ['me'], profile: 'read-only' } };
    cfg.mcpServers = { demo: { command: 'echo', args: ['hi'] } };
    await saveConfig(cfg);

    const loaded = await loadConfig();
    assert.deepEqual(loaded.channels, cfg.channels, 'channels was dropped by mergeConfig');
    assert.deepEqual(loaded.mcpServers, cfg.mcpServers);
    for (const key of Object.keys(cfg)) {
      assert.ok(key in loaded, `mergeConfig drops the "${key}" section`);
    }
  } finally {
    await cleanup(home);
  }
});
