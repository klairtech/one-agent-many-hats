/**
 * Prompt caching depends on one property: the prefix must not change between steps.
 * That is easy to break by adding a line to the top of the system prompt, and expensive
 * when it happens — so it is asserted rather than assumed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSystemParts } from '../src/engine/compose.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { splitOaiUsage } from '../src/providers/openaiCompat.js';
import { knownEnforcementPoints } from '../src/engine/gates.js';
import { Registry } from '../src/registry/loader.js';
import { cleanup, tempHome } from './helpers.js';

async function parts(over: Record<string, unknown> = {}) {
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  return buildSystemParts({
    skills: [registry.skill('core/discipline'), registry.skill('outcome/answer')],
    rules: registry.rules,
    memoryBlock: '## Workspace context\n\nA test workspace.',
    workspaceRoot: '/tmp/ws',
    profile: 'read-only',
    stage: 'act',
    stepsLeft: 9,
    conservative: false,
    ...over,
  } as never);
}

test('the stable half does not move when the stage, budget or hat changes', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const guardian = registry.behavioural().find((s) => s.role === 'guardian');

  const a = await parts({ stage: 'discover', stepsLeft: 12 });
  const b = await parts({ stage: 'verify', stepsLeft: 1, hat: guardian });

  assert.equal(a.stable, b.stable, 'the cacheable prefix must be byte-identical across steps');
  assert.notEqual(a.volatile, b.volatile, 'the per-step tail is what carries the difference');
  await cleanup(home);
});

test('per-step content is in the tail, never the prefix', async () => {
  const home = await tempHome();
  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const guardian = registry.behavioural().find((s) => s.role === 'guardian');
  const p = await parts({ stage: 'verify', stepsLeft: 3, hat: guardian });

  assert.ok(!/Steps remaining/.test(p.stable), 'the step budget must not be in the cached prefix');
  assert.ok(!/Stage:/.test(p.stable), 'the stage must not be in the cached prefix');
  assert.ok(!/# Hat:/.test(p.stable), 'the hat changes per step and must not be in the prefix');

  assert.match(p.volatile, /Stage: verify\. Steps remaining: 3\./);
  assert.match(p.volatile, /# Hat: guardian/);
  await cleanup(home);
});

test('the prefix is the expensive part, which is the point of caching it', async () => {
  const home = await tempHome();
  const p = await parts();
  // Skills, rules and memory all live in the prefix; only a couple of lines do not.
  assert.ok(p.stable.length > 2_000, `prefix was only ${p.stable.length} chars`);
  assert.ok(p.volatile.length < 400, `tail was ${p.volatile.length} chars — too much to re-send`);
  assert.equal(p.full, p.stable + '\n\n---\n\n' + p.volatile);
  await cleanup(home);
});

test('Anthropic gets cache breakpoints on the tools and the stable system block', async () => {
  const original = globalThis.fetch;
  let captured: Record<string, unknown> = {};

  globalThis.fetch = (async (_url: string, init: { body?: string }) => {
    captured = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: 4_000,
          cache_read_input_tokens: 0,
        },
      }),
    };
  }) as never;

  try {
    const provider = new AnthropicProvider(
      'anthropic',
      { kind: 'anthropic', baseUrl: 'https://example.invalid/v1' },
      'sk-test',
    );
    const res = await provider.chat({
      model: 'claude-test',
      system: 'stable\n\n---\n\nvolatile',
      systemParts: { stable: 'stable prefix', volatile: 'volatile tail' },
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        { name: 'a', description: 'first', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'second', parameters: { type: 'object', properties: {} } },
      ],
    });

    const system = captured['system'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(system), 'system must be blocks so a breakpoint can attach');
    assert.equal(system[0]?.['text'], 'stable prefix');
    assert.deepEqual(system[0]?.['cache_control'], { type: 'ephemeral' });
    assert.equal(system[1]?.['text'], 'volatile tail');
    assert.equal(system[1]?.['cache_control'], undefined, 'the tail must not be a breakpoint');

    const tools = captured['tools'] as Array<Record<string, unknown>>;
    assert.equal(tools[0]?.['cache_control'], undefined);
    assert.deepEqual(tools[1]?.['cache_control'], { type: 'ephemeral' }, 'last tool carries it');

    // Cache accounting has to reach the run record, or the saving is invisible.
    assert.equal(res.usage.cacheWriteTokens, 4_000);
    assert.equal(res.usage.cacheReadTokens, 0);
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Every one of these vendors folds cached tokens into its prompt total, and Anthropic does
 * not. If an adapter forgets to subtract, the cached tokens get billed twice in the cost
 * report — once at the full input rate and once at the cache rate — and a saving is shown
 * as an expense. These are the four real response shapes.
 */
test('cached tokens are subtracted out of inputTokens, not double-counted', () => {
  // OpenAI: prompt_tokens_details.cached_tokens, included in prompt_tokens.
  assert.deepEqual(
    splitOaiUsage({
      prompt_tokens: 5_000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 4_096 },
    }),
    { outputTokens: 100, inputTokens: 904, cacheReadTokens: 4_096 },
  );

  // DeepSeek: hit + miss = prompt_tokens, under its own field names.
  assert.deepEqual(
    splitOaiUsage({
      prompt_tokens: 5_000,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 4_096,
      prompt_cache_miss_tokens: 904,
    }),
    { outputTokens: 100, inputTokens: 904, cacheReadTokens: 4_096 },
  );

  // A vendor that reports no cache split: report the prompt total and claim no cache,
  // rather than inventing a zero that would read as "the cache missed".
  const plain = splitOaiUsage({ prompt_tokens: 5_000, completion_tokens: 100 });
  assert.equal(plain.inputTokens, 5_000);
  assert.equal(plain.cacheReadTokens, undefined);
});

test('Gemini cache hits are subtracted out of promptTokenCount', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 5_000,
        candidatesTokenCount: 100,
        cachedContentTokenCount: 4_096,
      },
    }),
  })) as never;

  try {
    const provider = new GeminiProvider(
      'gemini',
      { kind: 'gemini', baseUrl: 'https://example.invalid/v1beta' },
      'key',
    );
    const res = await provider.chat({
      model: 'gemini-test',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });
    assert.equal(res.usage.inputTokens, 904, 'the cached part must not be billed at full rate');
    assert.equal(res.usage.cacheReadTokens, 4_096);
  } finally {
    globalThis.fetch = original;
  }
});

test('a provider without systemParts still gets a plain system string', async () => {
  const original = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body?: string }) => {
    captured = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    return { ok: true, status: 200, json: async () => ({ content: [], usage: {} }) };
  }) as never;

  try {
    const provider = new AnthropicProvider(
      'anthropic',
      { kind: 'anthropic', baseUrl: 'https://example.invalid/v1' },
      'sk-test',
    );
    await provider.chat({
      model: 'm',
      system: 'just a string',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });
    assert.equal(captured['system'], 'just a string');
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Newer Anthropic models reject `temperature` with a 400 instead of ignoring it, which
 * kills the whole run. Binding the frontier tier to claude-sonnet-5 failed on step 1 with
 * "temperature is deprecated for this model". The adapter now drops it and retries once.
 */
test('a model that rejects temperature is retried without it', async () => {
  const original = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_url: string, init: { body?: string }) => {
    const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    bodies.push(body);
    if (body['temperature'] !== undefined) {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error: { message: '`temperature` is deprecated for this model.' } }),
        json: async () => ({ error: { message: '`temperature` is deprecated for this model.' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    };
  }) as never;

  try {
    const provider = new AnthropicProvider(
      'anthropic',
      { kind: 'anthropic', baseUrl: 'https://example.invalid/v1' },
      'sk-test',
    );
    const res = await provider.chat({
      model: 'claude-picky-1',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      temperature: 0.3,
    });
    assert.equal(res.text, 'ok', 'the retry should have succeeded');
    assert.equal(bodies.length, 2, 'expected one rejected call and one retry');
    assert.equal(bodies[0]?.['temperature'], 0.3);
    assert.equal(bodies[1]?.['temperature'], undefined, 'the retry must drop temperature');

    // And the model is remembered, so the next call does not waste a request.
    bodies.length = 0;
    await provider.chat({
      model: 'claude-picky-1',
      system: 's',
      messages: [{ role: 'user', content: 'again' }],
      tools: [],
      temperature: 0.3,
    });
    assert.equal(bodies.length, 1, 'the second call should not repeat the failure');
    assert.equal(bodies[0]?.['temperature'], undefined);
  } finally {
    globalThis.fetch = original;
  }
});
