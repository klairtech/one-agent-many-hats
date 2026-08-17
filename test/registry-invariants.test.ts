/**
 * The gaps you cannot see by reading one file.
 *
 * A live run denied `run_command`, `read_playbook` and `apply_patch` in a workspace where
 * all three were configured — because a skill mined from one throwaway question had gone
 * live with generic triggers and an allowlist narrower than the skill it specialised. No
 * single file was wrong. The *relationship* between them was.
 *
 * These check the relationships. Each one is a rule that was true by accident until it
 * stopped being, and each failure names what to fix rather than that something is off.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/core/config.js';
import { buildAllowlist } from '../src/engine/compose.js';
import { knownEnforcementPoints } from '../src/engine/gates.js';
import { packDir } from '../src/core/paths.js';
import { Registry } from '../src/registry/loader.js';
import { ALL_TOOLS } from '../src/tools/index.js';

// Loaded from the shipped packs, never from ~/.hats. Reading the live registry made these
// depend on whatever the machine happened to have promoted — the first version passed while
// a deliberately broken pack sat on disk, because it was checking a different directory
// than the one being edited.
const load = () => Registry.load({ knownGates: knownEnforcementPoints(), root: packDir() });
const toolNames = new Set(ALL_TOOLS.map((t) => t.spec.name));

function expand(patterns: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of patterns) {
    if (!p.endsWith('*')) { out.add(p); continue; }
    for (const n of toolNames) if (n.startsWith(p.slice(0, -1))) out.add(n);
  }
  return out;
}

function bodyOf(skillId: string): string {
  const dir = path.join(packDir(), 'skills');
  for (const f of readdirSync(dir)) {
    const raw = readFileSync(path.join(dir, f), 'utf8');
    if (new RegExp(`^id:\\s*${skillId.replace('/', '\\/')}\\s*$`, 'm').test(raw)) {
      return raw.split('---').slice(2).join('---');
    }
  }
  return '';
}

test('every shipped tool is reachable from at least one skill', async () => {
  const reg = await load();
  const granted = new Set<string>();
  for (const s of reg.skills) for (const t of expand(s.tools)) granted.add(t);

  const orphans = [...toolNames].filter((t) => !granted.has(t)).sort();
  assert.deepEqual(
    orphans,
    [],
    `these tools exist but no skill lists them, so nothing can ever call them: ${orphans.join(', ')}`,
  );
});

test('no skill lists a tool that does not exist', async () => {
  const reg = await load();
  const phantom: string[] = [];
  for (const s of reg.skills) {
    for (const t of s.tools) {
      if (!t.includes('*') && !toolNames.has(t)) phantom.push(`${s.id} -> ${t}`);
    }
  }
  // Silently dropped at composition time, so the skill quietly does less than it says.
  assert.deepEqual(phantom, [], `skills naming tools that are not in the registry: ${phantom.join(', ')}`);
});

/**
 * The one that would have caught the live failure: a skill whose own prose tells the agent
 * to call something its allowlist does not grant. The instruction reaches the model, the
 * call is refused, and the run reports a broken tool.
 */
test('a skill never instructs the agent to use a tool it does not grant', async () => {
  const reg = await load();
  const mismatches: string[] = [];

  for (const s of reg.skills) {
    // Cross-cutting skills declare no tools meaning "narrow nothing" — their prose advises
    // about tools the outcome skill grants, which is the design rather than a gap.
    if (s.kind !== 'outcome' && s.tools.length === 0) continue;
    const body = bodyOf(s.id);
    const granted = expand(s.tools);
    for (const t of toolNames) {
      if (granted.has(t)) continue;
      // Named as a call — in backticks or with an opening paren — not mentioned in passing.
      if (new RegExp('`' + t + '`|\\b' + t + '\\(').test(body)) mismatches.push(`${s.id} tells it to use ${t}`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('; '));
});

test('a review hat can read the thing it is judging', async () => {
  const reg = await load();
  for (const hat of reg.skills.filter((s) => s.role === 'guardian' || s.role === 'critic')) {
    // A review hat narrows the allowlist to its own list, so an empty or read-less list
    // leaves the verify pass unable to check a claim against its source.
    assert.ok(hat.tools.length > 0, `${hat.id} narrows the allowlist to nothing`);
    assert.ok(
      hat.tools.includes('read_file'),
      `${hat.id} cannot read a file, so it cannot verify any claim against its source`,
    );
  }
});

test('nothing is dropped from an allowlist for a reason nobody stated', async () => {
  const reg = await load();
  for (const enabled of [false, true]) {
    const config = { ...DEFAULT_CONFIG, network: { enabled, allowHosts: [] } };
    for (const profile of ['read-only', 'assisted', 'trusted'] as const) {
      for (const skill of reg.outcomes()) {
        const { dropped } = buildAllowlist(skill, ALL_TOOLS, config, profile);
        for (const d of dropped) {
          assert.match(
            d.why,
            /profile|egress|no tool matches/,
            `${skill.id} lost ${d.tool} at ${profile} for an unexplained reason: ${d.why}`,
          );
        }
      }
    }
  }
});
