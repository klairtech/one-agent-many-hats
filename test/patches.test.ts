/**
 * ADR-0010. This is the file that decides whether letting the agent edit tool code was a
 * good idea, so each of the four checks gets a test, plus the property that matters most:
 * a refused patch leaves the tree byte-identical to how it found it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { applyPatch, describePatch, validatePatch, type Patch } from '../src/registry/patches.js';
import { proposePatch } from '../src/tools/builtin/patch.js';
import { isHatsError } from '../src/core/errors.js';
import { cleanup, tempHome, testConfig } from './helpers.js';
import type { ToolContext } from '../src/tools/types.js';

const ORIGINAL = `export const tool = {
  spec: {
    name: 'demo',
    mutating: true,
    network: false,
  },
  run() {
    return findIt('first');
  },
};
`;

async function repo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'hats-patch-'));
  await mkdir(path.join(root, 'src', 'tools', 'builtin'), { recursive: true });
  await writeFile(path.join(root, 'src', 'tools', 'builtin', 'demo.ts'), ORIGINAL, 'utf8');
  return root;
}

function patch(over: Partial<Patch> = {}): Patch {
  return {
    id: 'p1',
    file: 'src/tools/builtin/demo.ts',
    find: "return findIt('first');",
    replace: "return findItProperly('first');",
    reason: 'the locator matched the wrong element',
    evidence: ['run_a', 'run_b'],
    ...over,
  };
}

const passes = async () => ({ ok: true as const, stage: 'test' as const, detail: '' });

test('a patch that fixes behaviour is applied', async () => {
  const root = await repo();
  try {
    const out = await applyPatch(patch(), { root, verify: passes });
    assert.equal(out.applied, true, out.reason);
    const after = await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8');
    assert.match(after, /findItProperly/);
  } finally {
    await cleanup(root);
  }
});

/** Check 2. The one that matters: behaviour is patchable, authority is not. */
test('a patch that changes a tool’s declared powers is refused', async () => {
  const root = await repo();
  try {
    for (const attempt of [
      { find: '    mutating: true,', replace: '    mutating: false,' },
      { find: '    network: false,', replace: '    network: true,' },
      { find: "    name: 'demo',", replace: "    name: 'demo',\n    minProfile: 'read-only'," },
      { find: "    name: 'demo',", replace: "    name: 'demo',\n    availableWhen: () => true," },
    ]) {
      const out = await applyPatch(patch(attempt), { root, verify: passes });
      assert.equal(out.applied, false, `allowed: ${attempt.replace.trim()}`);
      assert.equal(out.stage, 'authority');
    }
    const after = await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8');
    assert.equal(after, ORIGINAL, 'the file must be untouched');
  } finally {
    await cleanup(root);
  }
});

/** Check 1. The enforcement machinery is not editable at any autonomy level. */
test('the files that enforce the boundaries cannot be patched', async () => {
  for (const file of [
    'src/tools/executor.ts',
    'src/core/paths.ts',
    'src/core/net.ts',
    'src/schedule/grants.ts',
    'src/schedule/unattended.ts',
    'src/engine/gates.ts',
    'src/core/credentials.ts',
    'src/registry/patches.ts',
  ]) {
    const out = validatePatch(patch({ file }));
    assert.equal(out.applied, false, `${file} was patchable`);
    assert.equal(out.stage, 'path');
  }
  // And nothing outside the editable area, however it is spelled.
  for (const file of [
    'src/engine/run.ts',
    '../../../etc/passwd',
    '/etc/passwd',
    'src/tools/builtin/../../engine/run.ts',
    'package.json',
  ]) {
    assert.equal(validatePatch(patch({ file })).applied, false, `${file} was patchable`);
  }
});

/** Check 3, and the revert property. */
test('a patch that breaks the build is reverted', async () => {
  const root = await repo();
  try {
    const out = await applyPatch(patch(), {
      root,
      verify: async () => ({ ok: false, stage: 'build', detail: 'TS1005: expected' }),
    });
    assert.equal(out.applied, false);
    assert.equal(out.stage, 'build');
    assert.equal(await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8'), ORIGINAL);
  } finally {
    await cleanup(root);
  }
});

/** Check 4 — the substantive one. A patch that passes the compiler still has to pass the suite. */
test('a patch that compiles but breaks a test is reverted', async () => {
  const root = await repo();
  try {
    const out = await applyPatch(patch(), {
      root,
      verify: async () => ({ ok: false, stage: 'test', detail: 'not ok 12 - the sandbox refuses...' }),
    });
    assert.equal(out.applied, false);
    assert.equal(out.stage, 'test');
    assert.match(out.reason, /breaks the test suite/);
    assert.equal(await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8'), ORIGINAL);
  } finally {
    await cleanup(root);
  }
});

test('a verification that throws still restores the file', async () => {
  const root = await repo();
  try {
    const out = await applyPatch(patch(), {
      root,
      verify: async () => {
        throw new Error('npm vanished');
      },
    });
    assert.equal(out.applied, false);
    assert.equal(await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8'), ORIGINAL);
  } finally {
    await cleanup(root);
  }
});

test('the find text must exist and be unique', async () => {
  const root = await repo();
  try {
    const missing = await applyPatch(patch({ find: 'not in the file' }), { root, verify: passes });
    assert.equal(missing.stage, 'match');
    assert.match(missing.reason, /already be fixed/);

    // ",\n" appears after every spec field and again after the closing brace.
    const ambiguous = await applyPatch(patch({ find: ',\n', replace: ';\n' }), {
      root,
      verify: passes,
    });
    assert.equal(ambiguous.stage, 'match');
    assert.match(ambiguous.reason, /must be unique/);
    assert.equal(await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8'), ORIGINAL);
  } finally {
    await cleanup(root);
  }
});

/** The tool refuses at staging time, while the model can still act on the answer. */
test('propose_patch refuses an authority edit before it is ever staged', async () => {
  const ctx = {
    runId: 'r1',
    config: testConfig(),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as ToolContext;

  await assert.rejects(
    () =>
      proposePatch.run(
        {
          file: 'src/tools/builtin/demo.ts',
          find: 'mutating: true,',
          replace: 'mutating: false,',
          reason: 'it asks too often',
        },
        ctx,
      ),
    (e: unknown) => isHatsError(e) && /declared powers/.test((e as Error).message),
  );

  await assert.rejects(
    () =>
      proposePatch.run(
        { file: 'src/tools/executor.ts', find: 'a', replace: 'b', reason: 'because' },
        ctx,
      ),
    (e: unknown) => isHatsError(e) && /enforces the boundaries/.test((e as Error).message),
  );

  // Staging is a read-only act; only applying it changes anything.
  assert.equal(proposePatch.spec.mutating, false);
});

test('the description tells a reviewer what will happen', () => {
  const text = describePatch(patch());
  assert.match(text, /entire test suite/);
  assert.match(text, /never alter a tool’s declared powers/);
  assert.match(text, /findItProperly/);
});

/**
 * read_file returns line-numbered output, so a model quoting a block back gets the
 * indentation wrong by the width of the gutter. The first real patch the agent wrote was
 * correct in every character except six spaces, and was refused for it.
 */
test('a patch whose indentation is off still matches, and is re-indented to fit', async () => {
  const root = await repo();
  try {
    const out = await applyPatch(
      patch({
        // Every line shifted right by two, exactly as quoting a numbered read produces.
        find: "    run() {\n      return findIt('first');\n    },",
        replace: "    run() {\n      return findItProperly('first');\n    },",
      }),
      { root, verify: passes },
    );
    assert.equal(out.applied, true, out.reason);
    const after = await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8');
    assert.match(after, /findItProperly/);
    // Re-indented to the file's own shape, not the patch's.
    assert.ok(after.includes("    return findItProperly('first');"), after);
    assert.ok(!after.includes('      return findItProperly'), 'indentation was not corrected');
  } finally {
    await cleanup(root);
  }
});

test('an indentation-insensitive match must still be unique', async () => {
  const root = await repo();
  try {
    const out = await applyPatch(patch({ find: '},', replace: '};' }), { root, verify: passes });
    assert.equal(out.applied, false);
    assert.equal(out.stage, 'match');
    assert.equal(await readFile(path.join(root, 'src/tools/builtin/demo.ts'), 'utf8'), ORIGINAL);
  } finally {
    await cleanup(root);
  }
});

/**
 * The autonomy level widens *what may be repaired*, never *what may be permitted*. A patch
 * that reaches for authority must be refused at self-healing exactly as at supervised —
 * otherwise the level is a way to buy the thing the whole design refuses to sell.
 */
test('self-healing does not loosen what a patch may touch', async () => {
  const home = await tempHome();
  try {
    const { runAutoPromotion } = await import('../src/engine/autonomy.js');
    const { stageProposal, listProposals } = await import('../src/registry/proposals.js');
    const config = testConfig();
    config.autonomy.level = 'self-healing';

    await stageProposal({
      kind: 'tool',
      title: 'patch away an approval',
      rationale: 'it asks too often',
      content: 'x',
      evidence: [],
      patch: {
        id: '',
        file: 'src/tools/builtin/system.ts',
        find: '    mutating: true,',
        replace: '    mutating: false,',
        reason: 'fewer prompts',
        evidence: [],
      },
    });

    const result = await runAutoPromotion(config);
    assert.equal(result.promoted.length, 0, 'an authority patch was auto-applied');
    const [proposal] = await listProposals();
    assert.equal(proposal?.status, 'draft', 'it must stay a draft, as evidence');
  } finally {
    await cleanup(home);
  }
});

test('a tool proposal with no patch is still never auto-promoted', async () => {
  const home = await tempHome();
  try {
    const { runAutoPromotion } = await import('../src/engine/autonomy.js');
    const { stageProposal } = await import('../src/registry/proposals.js');
    const config = testConfig();
    config.autonomy.level = 'self-healing';

    await stageProposal({
      kind: 'tool',
      title: 'a brand new tool',
      rationale: 'would be handy',
      content: 'contract',
      evidence: [],
    });
    const result = await runAutoPromotion(config);
    assert.equal(result.promoted.length, 0);
    assert.equal(result.blocked.length, 1, 'new capability still needs a human');
  } finally {
    await cleanup(home);
  }
});
