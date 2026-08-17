import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { nullLogger } from '../src/core/logger.js';
import { PathGuard } from '../src/core/paths.js';
import { ArtifactStore } from '../src/tools/artifacts.js';
import { deriveMetric } from '../src/tools/builtin/compute.js';
import type { ToolContext } from '../src/tools/types.js';
import { cleanup, tempHome, tempWorkspace, testConfig } from './helpers.js';

async function makeCtx() {
  const home = await tempHome();
  const ws = await tempWorkspace({});
  const config = testConfig();
  const artifacts = new ArtifactStore(path.join(home, 'artifacts'), 'run_dm');
  const ctx: ToolContext = {
    runId: 'run_dm',
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

test('derive_metric: sum of artifact values', async () => {
  const { ctx, artifacts, ws, home } = await makeCtx();
  const source = await artifacts.put({
    kind: 'tool-result',
    tool: 'list_dir',
    summary: 'files',
    payload: [100, 250, 75],
  });

  const result = await deriveMetric.run(
    {
      operation: 'sum',
      inputs: [{ artifact_id: source.id }],
      label: 'total bytes',
    },
    ctx,
  );

  assert.ok(!result.failed, result.summary);
  const payload = result.payload as { value: number; formula: string };
  assert.equal(payload.value, 425);
  await cleanup(ws, home);
});

test('derive_metric: extract field from artifact', async () => {
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

  const result = await deriveMetric.run(
    {
      operation: 'sum',
      inputs: [{ artifact_id: source.id, field: 'size' }],
      label: 'total size',
    },
    ctx,
  );

  assert.ok(!result.failed, result.summary);
  const payload = result.payload as { value: number; formula: string };
  assert.equal(payload.value, 350);
  await cleanup(ws, home);
});

test('derive_metric: ratio of two inputs', async () => {
  const { ctx, artifacts, ws, home } = await makeCtx();
  const a = await artifacts.put({
    kind: 'tool-result',
    tool: 'test',
    summary: 'a',
    payload: 10,
  });
  const b = await artifacts.put({
    kind: 'tool-result',
    tool: 'test',
    summary: 'b',
    payload: 20,
  });

  const result = await deriveMetric.run(
    {
      operation: 'ratio',
      inputs: [{ artifact_id: a.id }, { artifact_id: b.id }],
      label: 'ratio',
    },
    ctx,
  );

  assert.ok(!result.failed, result.summary);
  const payload = result.payload as { value: number; formula: string };
  assert.equal(payload.value, 0.5);
  await cleanup(ws, home);
});

test('derive_metric: literal constant', async () => {
  const { ctx, artifacts, ws, home } = await makeCtx();
  const source = await artifacts.put({
    kind: 'tool-result',
    tool: 'test',
    summary: 'value',
    payload: 50,
  });

  const result = await deriveMetric.run(
    {
      operation: 'share',
      inputs: [{ artifact_id: source.id }, { literal: 100 }],
      label: 'percentage',
    },
    ctx,
  );

  assert.ok(!result.failed, result.summary);
  const payload = result.payload as { value: number; formula: string };
  assert.equal(payload.value, 50 / (50 + 100)); // 50 / 150 = 0.333...
  await cleanup(ws, home);
});

test('derive_metric: rejects input with neither artifact_id nor literal', async () => {
  const { ctx, ws, home } = await makeCtx();

  try {
    await deriveMetric.run(
      {
        operation: 'sum',
        inputs: [{ field: 'size' }],
        label: 'invalid input',
      },
      ctx,
    );
    assert.fail('should have thrown an error');
  } catch (e) {
    const err = e as { code?: string; message?: string };
    assert.equal(err.code, 'TOOL_INPUT_INVALID');
    assert.match(err.message ?? '', /artifact|no artifact/i);
  }
  await cleanup(ws, home);
});

test('derive_metric: rejects artifact with no extractable number', async () => {
  const { ctx, artifacts, ws, home } = await makeCtx();
  const source = await artifacts.put({
    kind: 'tool-result',
    tool: 'test',
    summary: 'text data',
    payload: { name: 'Alice', role: 'engineer' },
  });

  try {
    await deriveMetric.run(
      {
        operation: 'sum',
        inputs: [{ artifact_id: source.id }],
        label: 'sum of text',
      },
      ctx,
    );
    assert.fail('should have thrown an error');
  } catch (e) {
    const err = e as { code?: string; message?: string };
    assert.equal(err.code, 'TOOL_INPUT_INVALID');
    assert.match(err.message ?? '', /holds no number/);
  }
  await cleanup(ws, home);
});

test('derive_metric: mean operation', async () => {
  const { ctx, artifacts, ws, home } = await makeCtx();
  const source = await artifacts.put({
    kind: 'tool-result',
    tool: 'test',
    summary: 'values',
    payload: [10, 20, 30],
  });

  const result = await deriveMetric.run(
    {
      operation: 'mean',
      inputs: [{ artifact_id: source.id }],
      label: 'average',
    },
    ctx,
  );

  assert.ok(!result.failed, result.summary);
  const payload = result.payload as { value: number; formula: string };
  assert.equal(payload.value, 20);
  await cleanup(ws, home);
});
