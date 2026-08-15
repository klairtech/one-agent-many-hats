/**
 * Revising playbooks instead of duplicating them.
 *
 * Revising a skill is safe by construction — a skill only recomposes tools that already
 * exist, and the executor intersects its list with the profile anyway. Revising a *rule* is
 * the dangerous one, because rules are the boundary, and the dangerous edit does not look
 * dangerous: `strength: gate` -> `strength: prompt` parses cleanly, promotes cleanly, and
 * silently turns a check into a paragraph of advice.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { parseRule, syncPacks } from '../src/registry/loader.js';
import { promoteProposal, stageProposal } from '../src/registry/proposals.js';
import { cleanup, tempHome } from './helpers.js';
import { checkRuleRevision } from '../src/registry/revision.js';

function rule(over: Partial<Record<string, string>> = {}): string {
  return [
    '---',
    'id: rule/no-invented-numbers',
    'statement: >',
    '  Numbers in an answer must exist in an artifact.',
    `strength: ${over['strength'] ?? 'gate'}`,
    'scope: [verify, deliver]',
    `enforced_by: ${over['enforced_by'] ?? 'gates.numbersReconciled'}`,
    `on_violation: ${over['on_violation'] ?? 'block_and_reshape'}`,
    `version: ${over['version'] ?? '1'}`,
    '---',
    '',
    over['body'] ?? '# Numbers need evidence',
  ].join('\n');
}

const current = parseRule(rule(), 'current');

test('a revision may sharpen what a rule says', () => {
  const revised = parseRule(rule({ version: '2', body: '# Numbers need evidence\n\nNarrowed: all-numeric tokens like 26/26 are not paths.' }), 'revised');
  const check = checkRuleRevision(current, revised);
  assert.equal(check.ok, true, check.detail);
});

test('a revision may promote a rule up the ladder but never down it', () => {
  // prompt -> gate -> code is the paper's promotion ladder, and it only runs one way.
  const promoted = parseRule(rule({ strength: 'code', version: '2' }), 'revised');
  assert.equal(checkRuleRevision(current, promoted).ok, true);

  const demoted = parseRule(rule({ strength: 'prompt', version: '2' }), 'revised');
  const check = checkRuleRevision(current, demoted);
  assert.equal(check.ok, false, 'demoting a gate to a prompt removes the enforcement');
  assert.match(check.detail, /never demoted|lowers it/);
});

test('a revision may not repoint the enforcement away from the code that holds it', () => {
  // The subtle one: every word of the rule can stay identical while the check it names
  // stops being the check that runs.
  const moved = parseRule(rule({ enforced_by: 'gates.completionSupported', version: '2' }), 'revised');
  const check = checkRuleRevision(current, moved);
  assert.equal(check.ok, false);
  assert.match(check.detail, /enforcement point/);
});

test('a revision may not downgrade blocking to warning', () => {
  const softened = parseRule(rule({ on_violation: 'warn', version: '2' }), 'revised');
  assert.equal(checkRuleRevision(current, softened).ok, false);

  // A rule that only warned can be made to block: that is tightening, and allowed.
  const wasWarning = parseRule(rule({ on_violation: 'warn' }), 'current');
  const nowBlocks = parseRule(rule({ on_violation: 'block', version: '2' }), 'revised');
  assert.equal(checkRuleRevision(wasWarning, nowBlocks).ok, true);
});

test('promoting a revision replaces the playbook and keeps the old version', async () => {
  const home = await tempHome();
  try {
    const root = path.join(home, 'registry');
    await syncPacks(root);

    const live = path.join(root, 'skills', 'outcome-answer.md');
    const before = await fsp.readFile(live, 'utf8');
    const wasVersion = Number(/^version:\s*(\d+)$/m.exec(before)?.[1]);

    const revised = before.replace(
      '# Ad-hoc answer',
      '# Ad-hoc answer\n\nRevised: state which discovery strategies were tried before giving up.',
    );
    const staged = await stageProposal(
      {
        kind: 'skill',
        title: 'outcome/answer — say what discovery was tried',
        rationale: 'two runs reported "not found" without saying what they searched',
        evidence: ['run:test'],
        content: revised,
      },
      root,
    );
    await promoteProposal(staged.id, { root });

    const after = await fsp.readFile(live, 'utf8');
    assert.match(after, /Revised: state which discovery strategies/);
    // Replaced in place rather than added alongside: the whole point is not ending up with
    // two overlapping playbooks that make routing come out differently run to run.
    const skills = await fsp.readdir(path.join(root, 'skills'));
    assert.equal(skills.filter((f) => f.startsWith('outcome-answer')).length, 1);

    const nowVersion = Number(/^version:\s*(\d+)$/m.exec(after)?.[1]);
    assert.ok(nowVersion > wasVersion, `version did not advance: ${wasVersion} -> ${nowVersion}`);

    // The previous text survives, so a revision that turns out badly is revertible.
    const kept = await fsp.readdir(path.join(root, 'versions', 'skills', 'outcome-answer'));
    assert.ok(kept.length >= 1, 'no version history was written');
  } finally {
    await cleanup(home);
  }
});

test('a rule revision that weakens enforcement is refused at promotion', async () => {
  const home = await tempHome();
  try {
    const root = path.join(home, 'registry');
    await syncPacks(root);

    const live = path.join(root, 'rules', 'no-invented-numbers.md');
    const before = await fsp.readFile(live, 'utf8');
    assert.match(before, /^strength: gate$/m, 'precondition: this rule is a gate');

    const weakened = before.replace(/^strength: gate$/m, 'strength: prompt');
    const staged = await stageProposal(
      { kind: 'rule', title: 'relax numbers', rationale: 'it keeps firing', evidence: ['run:test'], content: weakened },
      root,
    );

    await assert.rejects(promoteProposal(staged.id, { root }), /never demoted|lowers it/);
    // Refused means unchanged, not partially applied.
    assert.equal(await fsp.readFile(live, 'utf8'), before);
  } finally {
    await cleanup(home);
  }
});

test('a rule revision replaces the shipped rule instead of writing a second one', async () => {
  const home = await tempHome();
  try {
    const root = path.join(home, 'registry');
    await syncPacks(root);

    const before = (await fsp.readdir(path.join(root, 'rules'))).length;
    const live = path.join(root, 'rules', 'no-invented-numbers.md');
    // Appended rather than substituted: the body of the shipped rule is prose whose exact
    // wording is not this test's business.
    const sharpened = `${await fsp.readFile(live, 'utf8')}\n\nNarrowed: all-numeric tokens like 26/26 are not file paths.\n`;
    const staged = await stageProposal(
      { kind: 'rule', title: 'narrow numbers', rationale: 'fired on 26/26', evidence: ['run:test'], content: sharpened },
      root,
    );
    await promoteProposal(staged.id, { root });

    // The bug this covers: the live file is found by the id *inside* it, not by slugifying
    // the id into a filename. `rule/no-invented-numbers` slugs to `rule-no-invented-numbers.md`
    // while the file shipped as `no-invented-numbers.md`, so every rule revision used to
    // write a second rule with the same id next to the first — and both then loaded.
    assert.equal((await fsp.readdir(path.join(root, 'rules'))).length, before, 'a duplicate rule was written');
    assert.match(await fsp.readFile(live, 'utf8'), /Narrowed: all-numeric tokens/);
  } finally {
    await cleanup(home);
  }
});
