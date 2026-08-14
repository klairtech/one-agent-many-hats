/**
 * Provider factory and tier router.
 *
 * Paper §2.2: "Routing is a coded seam, not a field the model invents mid-run." The
 * engine asks for a tier; this module turns a tier into a concrete provider and model id.
 * Nothing the model emits reaches this decision.
 */

import { HatsError } from '../core/errors.js';
import { resolveApiKey, resolveTier, type HatsConfig, type ProviderConfig, type Tier } from '../core/config.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider, type MockTurn } from './mock.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCompatProvider } from './openaiCompat.js';
import type { ChatProvider } from './types.js';

export * from './types.js';
export { MockProvider } from './mock.js';
export type { MockTurn } from './mock.js';

export function createProvider(id: string, cfg: ProviderConfig): ChatProvider {
  const key = resolveApiKey(id, cfg);
  switch (cfg.kind) {
    case 'ollama':
      return new OllamaProvider(id, cfg);
    case 'openai-compat':
      return new OpenAiCompatProvider(id, cfg, key);
    case 'anthropic':
      return new AnthropicProvider(id, cfg, key);
    case 'gemini':
      return new GeminiProvider(id, cfg, key);
    case 'mock':
      return new MockProvider(id, []);
    default:
      throw new HatsError('CONFIG_INVALID', `unknown provider kind "${cfg.kind}"`, { id });
  }
}

export interface ResolvedModel {
  provider: ChatProvider;
  providerId: string;
  model: string;
  tier: Tier;
}

/** Caches one adapter instance per provider id, so degradation memory survives a run. */
export class ProviderPool {
  private readonly cache = new Map<string, ChatProvider>();
  private readonly overrides = new Map<string, ChatProvider>();

  constructor(private readonly cfg: HatsConfig) {}

  /** Test seam: inject a scripted provider under a provider id. */
  register(id: string, provider: ChatProvider): void {
    this.overrides.set(id, provider);
  }

  static withMock(cfg: HatsConfig, script: MockTurn[], id = 'mock'): ProviderPool {
    const pool = new ProviderPool(cfg);
    pool.register(id, new MockProvider(id, script));
    return pool;
  }

  get(providerId: string): ChatProvider {
    const override = this.overrides.get(providerId);
    if (override) return override;
    const cached = this.cache.get(providerId);
    if (cached) return cached;
    const conf = this.cfg.providers[providerId];
    if (!conf) {
      throw new HatsError('CONFIG_INVALID', `provider "${providerId}" is not configured`, {
        known: Object.keys(this.cfg.providers),
      });
    }
    const created = createProvider(providerId, conf);
    this.cache.set(providerId, created);
    return created;
  }

  resolve(tier: Tier): ResolvedModel {
    const { providerId, model } = resolveTier(this.cfg, tier);
    return { provider: this.get(providerId), providerId, model, tier };
  }

  /** The provider that will serve embeddings, if any is configured for it. */
  embedder(): ChatProvider | undefined {
    for (const [id, conf] of Object.entries(this.cfg.providers)) {
      if (conf.embedModel) {
        const p = this.get(id);
        if (typeof p.embed === 'function') return p;
      }
    }
    return undefined;
  }
}
