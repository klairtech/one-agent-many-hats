/**
 * The isolation claims of ADR-0004, asserted rather than assumed.
 * If one of these fails, the ADR is wrong and must be rewritten before shipping.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { nullLogger } from '../src/core/logger.js';
import { PathGuard } from '../src/core/paths.js';
import { ArtifactStore } from '../src/tools/artifacts.js';
import { sandboxRun, validateOutput } from '../src/tools/sandbox/sandbox.js';
import type { ToolContext } from '../src/tools/types.js';
import { cleanup, tempHome, tempWorkspace, testConfig } from './helpers.js';

async function makeCtx() {
  const home = await tempHome();
  const ws = await tempWorkspace({});
  const config = testConfig();
  const artifacts = new ArtifactStore(path.join(home, 'artifacts'), 'run_sb');
  const ctx: ToolContext = {
    runId: 'run_sb',
    workspaceSlug: 'ws',
    workspaceRoot: ws,
    profile: 'read-only',
    stage: 'act',
    config,
    guard: new PathGuard([ws, home]),
    artifacts,
    logger: nullLogger,
    ask: async () => '',
    approve: async () => false,
    recordTaskDescriptor: () => {},
  };
  return { ctx, artifacts, ws, home };
}

test('computes over bound artifacts and stores a validated result', async () => {
  const { ctx, artifacts, ws, home } = await makeCtx();
  const source = await artifacts.put({
    kind: 'tool-result',
    tool: 'list_dir',
    summary: 'files',
    payload: [
      { rel: 'a.ts', size: 100 },
      { rel: 'b.ts', size: 250 },
    ],
  });

  const result = await sandboxRun.run(
    {
      task_descriptor: 'largest file',
      code: 'const rows = load_artifact("' + source.id + '"); const top = rows.slice().sort((x,y) => y.size - x.size)[0]; return { largest: top.rel, bytes: top.size, total: sum(rows, "size") };',
      artifact_ids: [source.id],
      expect: 'object',
    },
    ctx,
  );

  assert.ok(!result.failed, result.summary);
  const payload = result.payload as { largest: string; bytes: number; total: number };
  assert.equal(payload.largest, 'b.ts');
  assert.equal(payload.total, 350);

  const stored = await artifacts.get(result.artifactId ?? '');
  assert.equal(stored?.provenance['validated'], true);
  await cleanup(ws, home);
});

test('the host realm is not reachable from generated code', async () => {
  const { ctx, ws, home } = await makeCtx();
  const result = await sandboxRun.run(
    {
      task_descriptor: 'escape attempt',
      code: 'try { return { leaked: this.constructor.constructor("return typeof process")() }; } catch (e) { return { blocked: String(e.message) }; }',
    },
    ctx,
  );
  const payload = (result.payload ?? {}) as Record<string, unknown>;
  assert.ok(!('leaked' in payload) || payload['leaked'] === 'undefined', JSON.stringify(payload));
  await cleanup(ws, home);
});

test('no filesystem, no process, no network inside the sandbox', async () => {
  const { ctx, ws, home } = await makeCtx();
  const result = await sandboxRun.run(
    {
      task_descriptor: 'capability probe',
      code: 'return { req: typeof require, proc: typeof process, fetch: typeof fetch, imp: typeof globalThis.import };',
    },
    ctx,
  );
  assert.deepEqual(result.payload, {
    req: 'undefined',
    proc: 'undefined',
    fetch: 'undefined',
    imp: 'undefined',
  });
  await cleanup(ws, home);
});

test('an infinite loop is killed by the wall clock', async () => {
  const { ctx, ws, home } = await makeCtx();
  ctx.config.sandbox.timeoutMs = 800;
  const started = Date.now();
  const result = await sandboxRun.run(
    { task_descriptor: 'runaway', code: 'while (true) {}' },
    ctx,
  );
  assert.equal(result.failed, true);
  assert.match(result.summary, /timed out|exceeded/);
  assert.ok(Date.now() - started < 15_000);
  await cleanup(ws, home);
});

test('binding an artifact that is not in the run is refused', async () => {
  const { ctx, ws, home } = await makeCtx();
  await assert.rejects(
    sandboxRun.run(
      { task_descriptor: 'bad binding', code: 'return {a:1};', artifact_ids: ['art_nope'] },
      ctx,
    ),
    /no artifact/,
  );
  await cleanup(ws, home);
});

test('output validation rejects what is not evidence', () => {
  assert.match(String(validateOutput(null)), /returned nothing/);
  assert.match(String(validateOutput({})), /empty/);
  assert.match(String(validateOutput({ x: NaN })), /non-finite/);
  assert.match(String(validateOutput({ x: Infinity })), /non-finite/);
  assert.match(String(validateOutput([1, 2], 'object')), /expected an object/);
  assert.equal(validateOutput({ x: 1 }, 'object'), null);
});
