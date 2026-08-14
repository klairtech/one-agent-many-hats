/**
 * The executor is the security model (REPO_RULES §4.1). These tests are the reason the
 * "no code path reaches a handler except through execute()" invariant can be asserted.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { PathGuard } from '../src/core/paths.js';
import { nullLogger } from '../src/core/logger.js';
import { ArtifactStore } from '../src/tools/artifacts.js';
import { Executor } from '../src/tools/executor.js';
import { ALL_TOOLS, toolRegistry } from '../src/tools/index.js';
import type { ToolContext, ToolHandler } from '../src/tools/types.js';
import { cleanup, tempHome, tempWorkspace, testConfig } from './helpers.js';

async function makeExecutor(over: Partial<ToolContext> = {}, workspaceFiles = {}) {
  const home = await tempHome();
  const ws = await tempWorkspace(workspaceFiles);
  const config = testConfig();
  const ctx: ToolContext = {
    runId: 'run_test',
    workspaceSlug: 'ws',
    workspaceRoot: ws,
    profile: 'read-only',
    stage: 'act',
    config,
    guard: new PathGuard([ws, home]),
    artifacts: new ArtifactStore(path.join(home, 'artifacts'), 'run_test'),
    logger: nullLogger,
    ask: async () => 'answer',
    approve: async () => false,
    recordTaskDescriptor: () => {},
    ...over,
  };
  return { executor: new Executor(toolRegistry(), ctx), ctx, ws, home };
}

test('an invented tool name is refused and cites the allowlist rule', async () => {
  const { executor, ws, home } = await makeExecutor();
  const obs = await executor.execute(
    { id: '1', name: 'exfiltrate_everything', args: {} },
    { allowlist: new Set(['read_file']) },
  );
  assert.equal(obs.ok, false);
  assert.equal(obs.errorCode, 'TOOL_UNKNOWN');
  assert.equal(obs.ruleId, 'rule/allowlist-intersection');
  await cleanup(ws, home);
});

test('a real tool outside the allowlist is refused', async () => {
  const { executor, ws, home } = await makeExecutor({}, { 'a.txt': 'hello' });
  const obs = await executor.execute(
    { id: '1', name: 'read_file', args: { path: 'a.txt' } },
    { allowlist: new Set(['list_dir']) },
  );
  assert.equal(obs.ok, false);
  assert.equal(obs.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(obs.ruleId, 'rule/allowlist-intersection');
  await cleanup(ws, home);
});

test('a mutating tool is refused under read-only and cites the profile rule', async () => {
  const { executor, ws, home } = await makeExecutor();
  const obs = await executor.execute(
    { id: '1', name: 'write_file', args: { path: 'x.txt', content: 'hi' } },
    { allowlist: new Set(['write_file']) },
  );
  assert.equal(obs.ok, false);
  assert.equal(obs.ruleId, 'rule/profile-not-model-selectable');
  await cleanup(ws, home);
});

test('mutating tools are absent from the surface the model is shown under read-only', async () => {
  const { executor, ws, home } = await makeExecutor();
  const visible = executor.visibleTools(new Set(ALL_TOOLS.map((t) => t.spec.name)));
  const names = visible.map((v) => v.spec.name);
  assert.ok(!names.includes('write_file'), 'write_file must not be offered');
  assert.ok(!names.includes('run_command'), 'run_command must not be offered');
  assert.ok(!names.includes('fetch_url'), 'fetch_url must not be offered with network off');
  assert.ok(names.includes('read_file'));
  await cleanup(ws, home);
});

test('an approved mutation runs; a declined one is refused and told not to retry', async () => {
  let asked = 0;
  const { executor, ws, home } = await makeExecutor(
    { profile: 'assisted', approve: async () => (++asked === 1 ? true : false) },
    { 'a.txt': 'hello' },
  );
  const first = await executor.execute(
    { id: '1', name: 'write_file', args: { path: 'b.txt', content: 'written' } },
    { allowlist: new Set(['write_file']) },
  );
  assert.equal(first.ok, true);

  const second = await executor.execute(
    { id: '2', name: 'write_file', args: { path: 'c.txt', content: 'nope' } },
    { allowlist: new Set(['write_file']) },
  );
  assert.equal(second.ok, false);
  assert.equal(second.errorCode, 'APPROVAL_DENIED');
  assert.match(second.summary, /Do not retry/);
  await cleanup(ws, home);
});

test('bad arguments fail schema validation before the handler runs', async () => {
  const { executor, ws, home } = await makeExecutor();
  const obs = await executor.execute(
    { id: '1', name: 'read_file', args: { pth: 'typo.txt' } },
    { allowlist: new Set(['read_file']) },
  );
  assert.equal(obs.errorCode, 'TOOL_INPUT_INVALID');
  assert.match(obs.summary, /is required/);
  await cleanup(ws, home);
});

test('a large result is shaped to a bounded summary and stored whole as an artifact', async () => {
  const big = 'x'.repeat(50_000);
  const { executor, ctx, ws, home } = await makeExecutor({}, { 'big.txt': big });
  const obs = await executor.execute(
    { id: '1', name: 'read_file', args: { path: 'big.txt' } },
    { allowlist: new Set(['read_file']) },
  );
  assert.equal(obs.ok, true);
  assert.ok(obs.summary.length < 6_000, `summary was ${obs.summary.length} chars`);
  assert.match(obs.summary, /truncated: \d+ of \d+ characters/);

  const artifact = await ctx.artifacts.get(obs.artifactId ?? '');
  assert.ok(artifact, 'the whole result must be retained');
  const payload = artifact?.payload as { content: string };
  assert.equal(payload.content.length, big.length);
  await cleanup(ws, home);
});

test('search_files given a file searches that file instead of reporting zero files', async () => {
  // A live run had the model pass package.json as the search root; walking a file yields
  // nothing, and "no matches in 0 files" reads like an answer rather than a mistake.
  const { executor, ws, home } = await makeExecutor({}, { 'package.json': '{"version": "0.1.0"}' });
  const obs = await executor.execute(
    { id: '1', name: 'search_files', args: { pattern: 'version', path: 'package.json' } },
    { allowlist: new Set(['search_files']) },
  );
  assert.equal(obs.ok, true);
  assert.match(obs.summary, /1 matches in 1 files/);
  assert.match(obs.summary, /0\.1\.0/);
  await cleanup(ws, home);
});

test('a gate blocks the call and the block cites its rule', async () => {
  const { executor, ws, home } = await makeExecutor({}, { 'a.txt': 'hello' });
  const obs = await executor.execute(
    { id: '1', name: 'read_file', args: { path: 'a.txt' } },
    {
      allowlist: new Set(['read_file']),
      gates: [
        {
          ruleId: 'rule/test-gate',
          name: 'test.gate',
          check: () => 'not during a test',
        },
      ],
    },
  );
  assert.equal(obs.ok, false);
  assert.equal(obs.errorCode, 'GATE_BLOCKED');
  assert.equal(obs.ruleId, 'rule/test-gate');
  await cleanup(ws, home);
});

test('reading outside the workspace is refused by the path guard', async () => {
  const { executor, ws, home } = await makeExecutor();
  const obs = await executor.execute(
    { id: '1', name: 'read_file', args: { path: '/etc/passwd' } },
    { allowlist: new Set(['read_file']) },
  );
  assert.equal(obs.ok, false);
  assert.equal(obs.ruleId, 'rule/workspace-scope');
  await cleanup(ws, home);
});

test('a clarification pause is not swallowed as an observation', async () => {
  const { executor, ws, home } = await makeExecutor({
    ask: async () => {
      const { HatsError } = await import('../src/core/errors.js');
      throw new HatsError('CLARIFICATION_REQUIRED', 'which one?', {});
    },
  });
  await assert.rejects(
    executor.execute(
      { id: '1', name: 'ask_user', args: { question: 'which one?' } },
      { allowlist: new Set(['ask_user']) },
    ),
    /which one/,
  );
  await cleanup(ws, home);
});

test('every registered tool declares a profile and a schema', () => {
  const seen = new Set<string>();
  for (const handler of ALL_TOOLS as ToolHandler[]) {
    assert.ok(handler.spec.description.length > 40, `${handler.spec.name} needs a real description`);
    assert.equal(handler.spec.parameters.type, 'object');
    assert.ok(['read-only', 'assisted', 'trusted'].includes(handler.spec.minProfile));
    assert.ok(!seen.has(handler.spec.name), `duplicate tool ${handler.spec.name}`);
    seen.add(handler.spec.name);
  }
});
