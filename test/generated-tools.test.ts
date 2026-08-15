/**
 * Tools the agent wrote itself (ADR-0011).
 *
 * The security argument for this feature is one sentence: a generated tool's spec is not a
 * promise about what the code does, it is the input to the flags the process is started
 * with. These tests exist to keep that sentence true — every one of them asserts that a
 * declaration was *enforced*, not that it was recorded.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { generatedToolsDir } from '../src/core/paths.js';
import { loadGeneratedTools } from '../src/tools/generated/index.js';
import { atLeast } from '../src/engine/autonomy.js';
import { generatedHandler, permissionFlags } from '../src/tools/generated/handler.js';
import { assertUsableName, listGeneratedTools, writeGeneratedTool } from '../src/tools/generated/store.js';
import { smokeTest } from '../src/tools/generated/verify.js';
import type { GeneratedTool } from '../src/tools/generated/store.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { cleanup, tempHome } from './helpers.js';

function tool(over: Partial<GeneratedTool> = {}): GeneratedTool {
  return {
    name: 'probe_tool',
    description: 'a tool for the tests',
    parameters: { type: 'object', properties: {} },
    mutating: false,
    network: false,
    minProfile: 'read-only',
    credentials: [],
    rationale: 'exercised by the suite',
    writtenBy: { runId: 'run_test', at: '2026-08-15T00:00:00Z' },
    ...over,
  };
}

function ctx(workspaceRoot: string): Parameters<ReturnType<typeof generatedHandler>['run']>[1] {
  return {
    runId: 'run_test',
    workspaceSlug: 'test',
    workspaceRoot,
    profile: 'trusted',
    stage: 'act',
    config: {} as never,
    guard: {} as never,
    artifacts: {} as never,
    logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
    ask: async () => '',
    approve: async () => true,
    recordTaskDescriptor() {},
  };
}

test('a tool that declared mutating: false cannot write, whatever its code attempts', async () => {
  const home = await tempHome();
  try {
    const target = path.join(home, 'should-never-exist.txt');
    const code = `
      export async function run(args, ctx) {
        const fs = await ctx.import('node:fs');
        fs.writeFileSync(${JSON.stringify(target)}, 'x');
        return { summary: 'wrote the file' };
      }`;
    await writeGeneratedTool(tool(), code, path.join(home, 'tools'));

    const handler = generatedHandler(tool());
    const result = await handler.run({}, ctx(home));

    assert.equal(result.failed, true, 'the write should have been denied');
    assert.match(result.summary, /restricted|permission/i);
    // The point of the test: not that we refused, but that the file is not there.
    await assert.rejects(fsp.stat(target), 'the tool wrote a file it had no permission to write');
  } finally {
    await cleanup(home);
  }
});

test('a tool that declared network: false gets neither fetch nor a socket module', async () => {
  const home = await tempHome();
  try {
    const code = `
      export async function run(args, ctx) {
        if (typeof fetch !== 'undefined') return { summary: 'fetch survived' };
        try { await ctx.import('node:net'); return { summary: 'net survived' }; }
        catch (e) { return { summary: 'denied: ' + e.message }; }
      }`;
    await writeGeneratedTool(tool(), code, path.join(home, 'tools'));

    const result = await generatedHandler(tool()).run({}, ctx(home));
    assert.match(result.summary, /^denied:/, `network leaked: ${result.summary}`);
  } finally {
    await cleanup(home);
  }
});

test('a tool that declared its powers is granted exactly those and no more', async () => {
  const read = permissionFlags(tool(), '/w');
  assert.deepEqual(read, ['--permission'], 'a read-only tool must get no filesystem grant');

  const write = permissionFlags(tool({ mutating: true }), '/w');
  assert.ok(write.includes('--allow-fs-write=/w/'), 'a mutating tool needs its workspace');
  assert.ok(
    !write.some((f) => f.includes('--allow-child-process') || f.includes('--allow-worker')),
    'nothing should hand a generated tool a subprocess or a worker',
  );
  // Scoped to the workspace: a mutating tool may change the user's project, never the
  // runtime that supervises it.
  assert.ok(!write.some((f) => f === '--allow-fs-write' || f.endsWith('=*')));
});

test('the smoke test refuses code that does not compile or does not export run', async () => {
  const home = await tempHome();
  try {
    const broken = await smokeTest(tool(), 'export async function run( {', home);
    assert.equal(broken.ok, false);
    assert.equal(broken.stage, 'compile');

    const wrongShape = await smokeTest(tool(), 'export const notRun = 1;', home);
    assert.equal(wrongShape.ok, false);
    assert.match(wrongShape.detail, /run/);

    const fine = await smokeTest(tool(), 'export async function run() { return { summary: "ok" }; }', home);
    assert.equal(fine.ok, true, fine.detail);
  } finally {
    await cleanup(home);
  }
});

test('a generated tool may not take the name of a built-in', () => {
  const builtins = ALL_TOOLS.map((h) => h.spec.name);
  assert.ok(builtins.includes('write_file'), 'precondition: write_file is a built-in');

  // The whole feature is about trust, so `write_file` silently resolving to agent-written
  // code is the worst available outcome and must be refused at the name.
  assert.throws(() => assertUsableName('write_file', builtins), /already exists/);
  assert.throws(() => assertUsableName('Athena-Query', builtins), /snake_case/);
  assert.doesNotThrow(() => assertUsableName('athena_query', builtins));
});

test('credentials the tool named reach its process and never its summary', async () => {
  const home = await tempHome();
  try {
    const code = `
      export async function run(args, ctx) {
        return { summary: 'saw keys: ' + Object.keys(ctx.credentials || {}).join(',') };
      }`;
    const t = tool({ credentials: ['probe_key'] });
    await writeGeneratedTool(t, code, path.join(home, 'tools'));

    // Nothing stored yet: the tool must say what it needs rather than run without it.
    const missing = await generatedHandler(t).run({}, ctx(home));
    assert.equal(missing.failed, true);
    assert.match(missing.summary, /probe_key/);
    assert.match(missing.summary, /ask_user/, 'it should say how to obtain the credential');
  } finally {
    await cleanup(home);
  }
});

test('a malformed tool directory is skipped rather than breaking the runtime', async () => {
  const home = await tempHome();
  try {
    const root = path.join(home, 'tools');
    await writeGeneratedTool(tool({ name: 'good_tool' }), 'export async function run(){return{summary:"y"}}', root);

    // A manifest whose name does not match its directory would let one tool answer to
    // another's name after a rename.
    await fsp.mkdir(path.join(root, 'liar'), { recursive: true });
    await fsp.writeFile(path.join(root, 'liar', 'tool.json'), JSON.stringify(tool({ name: 'good_tool' })));
    await fsp.mkdir(path.join(root, 'broken'), { recursive: true });
    await fsp.writeFile(path.join(root, 'broken', 'tool.json'), '{ not json');

    const found = await listGeneratedTools(root);
    assert.deepEqual(found.map((f) => f.tool.name), ['good_tool']);
  } finally {
    await cleanup(home);
  }
});

test('autonomy levels are a ladder, so raising one never switches another off', () => {
  // The bug this replaced: self-healing was checked with `!== 'adaptive'`, so turning on
  // patch repair silently stopped skills and rules from promoting.
  assert.equal(atLeast('self-healing', 'adaptive'), true, 'self-healing must keep adaptive powers');
  assert.equal(atLeast('self-extending', 'self-healing'), true);
  assert.equal(atLeast('self-extending', 'adaptive'), true);
  assert.equal(atLeast('adaptive', 'self-healing'), false);
  assert.equal(atLeast('supervised', 'adaptive'), false);
});

/**
 * The live failure: build_tool declared `parameters` as an object with no properties, so
 * our own validator emptied the model's schema to `{}`. The tool installed with no schema,
 * and the next provider call died on `tools.17.custom.input_schema.type: Field required` —
 * which fails the whole request, so one malformed generated tool took out every tool in
 * the list and, because generated tools load at session start, every later run too.
 */
test('a generated tool can never present a schema a provider will reject', async () => {
  const home = await tempHome();
  try {
    const root = path.join(home, 'tools');
    for (const [name, parameters] of [
      ['empty_schema', {}],
      ['no_type', { properties: { q: { type: 'string' } } }],
      ['wrong_type', { type: 'string' }],
    ] as Array<[string, unknown]>) {
      await writeGeneratedTool(
        { ...tool({ name }), parameters: parameters as never },
        'export async function run(){return{summary:"ok"}}',
        root,
      );
    }

    const loaded = await listGeneratedTools(root);
    assert.equal(loaded.length, 3);
    for (const { tool: t } of loaded) {
      assert.equal(t.parameters.type, 'object', `${t.name} would be refused by the provider`);
      assert.ok(t.parameters.properties, `${t.name} has no properties object`);
    }
    // The declared property survives when there was one — the guard repairs, never erases.
    const kept = loaded.find((l) => l.tool.name === 'no_type');
    assert.ok(kept?.tool.parameters.properties?.['q'], 'repairing the schema dropped a real field');
  } finally {
    await cleanup(home);
  }
});

test('build_tool passes the model-authored schema through instead of validating it away', () => {
  const spec = ALL_TOOLS.find((t) => t.spec.name === 'build_tool')?.spec;
  assert.ok(spec, 'build_tool must be registered');
  // Our validator models a subset of JSON Schema; `parameters` is arbitrary JSON Schema the
  // model wrote. Validating it is how it became `{}`.
  assert.equal(spec.passthroughInput, true);
});

test('a conversation-scoped tool runs without ever being written to the workspace', async () => {
  const home = await tempHome();
  try {
    const code = 'export async function run(){ return { summary: "ran from memory" }; }';
    // No writeGeneratedTool call: the handler is given the source directly, which is what
    // makes "keep this only for now" possible rather than a promise we clean up later.
    const result = await generatedHandler(tool(), code).run({}, ctx(home));

    assert.equal(result.summary, 'ran from memory');
    await assert.rejects(
      fsp.stat(path.join(home, 'workspaces', 'ws-test', 'tools', 'probe_tool')),
      'a conversation-scoped tool left a directory behind',
    );
  } finally {
    await cleanup(home);
  }
});

test('a tool built once is available on the whole device, not just where it was built', async () => {
  const home = await tempHome();
  try {
    // One directory, shared by every workspace: a connector is a capability of this machine
    // rather than of one project, so having built it once the agent has it everywhere.
    const root = generatedToolsDir();
    assert.equal(root, path.join(home, 'tools'));

    await writeGeneratedTool(tool({ name: 'orders_api' }), 'export async function run(){return{summary:"y"}}', root);
    const loaded = await loadGeneratedTools(ALL_TOOLS);
    assert.ok(
      loaded.some((h) => h.spec.name === 'orders_api'),
      'a stored tool did not join the registry',
    );
  } finally {
    await cleanup(home);
  }
});
