/**
 * `hats verify [provider]` — prove an adapter actually works against the live API.
 *
 * Four checks, each independently useful when it fails:
 *   1. credential resolves (from the environment; the value is never read into output)
 *   2. the model list comes back
 *   3. a plain chat round-trips
 *   4. native tool calling round-trips — and if it does not, that the text-protocol
 *      fallback does
 *
 * This exists because the honest limit in docs/LIMITS.md was "two adapters have never
 * been executed against a live API". A user with a key can close that gap in ten seconds
 * without pasting the key anywhere.
 */

import { apiKeyEnvName, loadConfig, resolveApiKey, resolveTier, type ProviderConfig } from '../core/config.js';
import { toHatsError } from '../core/errors.js';
import { PRESETS } from '../core/presets.js';
import { createProvider } from '../providers/index.js';
import type { ChatProvider, ToolSchema } from '../providers/types.js';
import { out, paint } from './render.js';

const PROBE_TOOL: ToolSchema = {
  name: 'report_colour',
  description: 'Report the colour the user names. Call this instead of answering in prose.',
  parameters: {
    type: 'object',
    properties: { colour: { type: 'string', description: 'the colour named' } },
    required: ['colour'],
  },
};

export async function verifyProvider(providerId?: string, modelOverride?: string): Promise<number> {
  const config = await loadConfig();
  const ids = providerId ? [providerId] : Object.keys(config.providers);
  let failures = 0;

  for (const id of ids) {
    const preset = PRESETS[id];
    const conf: ProviderConfig = config.providers[id] ?? {
      kind: preset?.kind ?? 'openai-compat',
      baseUrl: preset?.baseUrl ?? '',
      ...(preset?.modelsPath ? { modelsPath: preset.modelsPath } : {}),
      ...(preset?.apiKeyEnv ? { apiKeyEnv: preset.apiKeyEnv } : {}),
    };

    out.heading(`${id}  ${paint(conf.baseUrl, 'grey')}`);

    // 1. credential
    const envName = apiKeyEnvName(id, conf);
    const key = resolveApiKey(id, conf);
    if (!envName) out.ok('no key needed');
    else if (key) out.ok(`${envName} is set (${key.length} chars — the value is never printed or stored)`);
    else {
      out.fail(`${envName} is not set in this shell. Run:  export ${envName}=…`);
      failures++;
      continue;
    }

    const provider = createProvider(id, conf);

    // 2. model list
    let models: string[] = [];
    try {
      models = (await provider.listModels()).map((m) => m.id);
      out.ok(`model list: ${models.length} models (e.g. ${models.slice(0, 3).join(', ')})`);
    } catch (e) {
      out.fail(`model list failed: ${toHatsError(e).message}`);
      failures++;
      continue;
    }

    const model = modelOverride ?? pickModel(config, id, models);
    if (!model) {
      out.warn('no model to test with — pass --model <id>');
      failures++;
      continue;
    }
    out.keyValue('testing with', model);

    // 3. plain chat
    try {
      const res = await provider.chat({
        model,
        system: 'Answer with a single word.',
        messages: [{ role: 'user', content: 'Say the word: ready' }],
        tools: [],
        maxTokens: 32,
        temperature: 0,
      });
      const text = res.text.trim().slice(0, 60);
      if (text) {
        out.ok(`chat round-trip: "${text}"${usage(res.usage)}`);
      } else {
        out.warn('chat returned no text');
        failures++;
      }
    } catch (e) {
      out.fail(`chat failed: ${toHatsError(e).message}`);
      failures++;
      continue;
    }

    // 4. tool calling
    try {
      const res = await provider.chat({
        model,
        system: 'You must call the tool. Do not answer in prose.',
        messages: [{ role: 'user', content: 'The colour is teal. Report it.' }],
        tools: [PROBE_TOOL],
        maxTokens: 256,
        temperature: 0,
      });
      const call = res.toolCalls[0];
      if (call) {
        const colour = String((call.args as Record<string, unknown>)['colour'] ?? '');
        const label = res.protocolUsed === 'native' ? 'native tool calling' : 'text tool protocol (degraded)';
        const styled = res.protocolUsed === 'native' ? out.ok : out.warn;
        styled.call(out, `${label}: ${call.name}(colour="${colour}")`);
        if (res.protocolUsed === 'text') {
          out.dim('   this model has no native tool support; hats fell back automatically');
        }
      } else {
        out.warn(`no tool call — the model answered in prose instead: "${res.text.trim().slice(0, 60)}"`);
        out.dim('   the engine will still work, but tool selection on this model will be unreliable');
      }
    } catch (e) {
      out.fail(`tool calling failed: ${toHatsError(e).message}`);
      failures++;
    }
  }

  out.line('');
  if (failures === 0) out.ok('everything checked out');
  else out.fail(`${failures} check(s) failed`);
  return failures === 0 ? 0 : 1;
}

function pickModel(
  config: Awaited<ReturnType<typeof loadConfig>>,
  providerId: string,
  models: string[],
): string | undefined {
  try {
    const bound = resolveTier(config, 'standard');
    if (bound.providerId === providerId) return bound.model;
  } catch {
    /* nothing bound yet */
  }
  // Prefer something small and cheap for a probe when we have to guess.
  const cheap = models.find((m) => /mini|flash|haiku|small|turbo|8b|7b|3b/i.test(m));
  return cheap ?? models[0];
}

function usage(u: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): string {
  if (u.inputTokens === undefined && u.outputTokens === undefined) return '';
  const parts = [`${u.inputTokens ?? '?'} in`, `${u.outputTokens ?? '?'} out`];
  // Shown only when the provider reports it, so absence reads as "not reported"
  // rather than as a confident zero.
  if (u.cacheWriteTokens) parts.push(`${u.cacheWriteTokens} cache-write`);
  if (u.cacheReadTokens) parts.push(`${u.cacheReadTokens} cached`);
  return `  [${parts.join(' / ')}]`;
}
