/**
 * Model pricing, from a source that is actually live.
 *
 * There is no cross-vendor pricing API. Hardcoding a table would be stale within a week
 * and would put numbers in front of the user that nothing verifies. OpenRouter's public
 * `/api/v1/models` is the exception: [VERIFIED 2026-08-14] it returns 411 models, every
 * one carrying a `pricing` object, and its catalogue covers OpenAI, Anthropic, Google,
 * DeepSeek, Qwen, Moonshot and others under their own ids.
 *
 * So: for `openrouter`, the price shown is the price you pay. For a direct provider, it is
 * OpenRouter's price for the same model, labelled as a cross-reference — close enough to
 * choose between models, and never presented as the vendor's own rate.
 */

import path from 'node:path';

import { hatsHome } from '../core/paths.js';
import { readJson, writeJsonAtomic } from '../core/store.js';

const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface CatalogueEntry {
  id: string;
  name?: string;
  contextLength?: number;
  /** US dollars per million tokens. */
  promptPerM?: number;
  completionPerM?: number;
  /** Cache reads bill at a fraction of input; writes at a premium. Both are published. */
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export interface PriceQuote {
  promptPerM?: number;
  completionPerM?: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  contextLength?: number;
  matchedId: string;
  /** `exact` when the user is on OpenRouter; `cross-reference` otherwise. */
  basis: 'exact' | 'cross-reference';
}

interface CacheFile {
  fetchedAt: number;
  entries: CatalogueEntry[];
}

function cachePath(): string {
  return path.join(hatsHome(), 'cache', 'openrouter-models.json');
}

/** Cached for six hours; a stale catalogue beats a request on every keystroke. */
export async function catalogue(force = false): Promise<CatalogueEntry[]> {
  const cached = await readJson<CacheFile | null>(cachePath(), null);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.entries;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(CATALOGUE_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
      }>;
    };
    const entries: CatalogueEntry[] = (body.data ?? [])
      .filter((m): m is { id: string } & typeof m => typeof m.id === 'string')
      .map((m) => ({
        id: m.id,
        ...(m.name ? { name: m.name } : {}),
        ...(m.context_length ? { contextLength: m.context_length } : {}),
        ...(perMillion(m.pricing?.prompt) !== undefined
          ? { promptPerM: perMillion(m.pricing?.prompt) }
          : {}),
        ...(perMillion(m.pricing?.completion) !== undefined
          ? { completionPerM: perMillion(m.pricing?.completion) }
          : {}),
        ...(perMillion(m.pricing?.input_cache_read) !== undefined
          ? { cacheReadPerM: perMillion(m.pricing?.input_cache_read) }
          : {}),
        ...(perMillion(m.pricing?.input_cache_write) !== undefined
          ? { cacheWritePerM: perMillion(m.pricing?.input_cache_write) }
          : {}),
      }));
    await writeJsonAtomic(cachePath(), { fetchedAt: Date.now(), entries } satisfies CacheFile);
    return entries;
  } catch {
    // Offline, or the endpoint moved. Stale beats nothing; nothing beats invented.
    return cached?.entries ?? [];
  }
}

/** Vendor prefixes OpenRouter uses, so a direct-provider model can be found. */
const VENDOR_PREFIX: Record<string, string[]> = {
  openai: ['openai'],
  anthropic: ['anthropic'],
  gemini: ['google'],
  deepseek: ['deepseek'],
  qwen: ['qwen', 'alibaba'],
  kimi: ['moonshotai', 'moonshot'],
  glm: ['z-ai', 'zhipu', 'thudm'],
  mistral: ['mistralai', 'mistral'],
  xai: ['x-ai', 'xai'],
  groq: [],
  together: [],
  openrouter: [],
};

export function quote(
  entries: CatalogueEntry[],
  providerId: string,
  modelId: string,
): PriceQuote | null {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();

  if (providerId === 'openrouter') {
    const hit = entries.find((e) => e.id.toLowerCase() === lower);
    return hit ? toQuote(hit, 'exact') : null;
  }

  // Local servers have no per-token price; saying "free" would be more honest than a
  // cross-reference, and the UI says so rather than showing a number.
  if (providerId === 'ollama' || providerId === 'lmstudio' || providerId === 'vllm') return null;

  const prefixes = VENDOR_PREFIX[providerId] ?? [];
  for (const prefix of prefixes) {
    const exact = entries.find((e) => e.id.toLowerCase() === `${prefix}/${lower}`);
    if (exact) return toQuote(exact, 'cross-reference');
  }
  // Fall back to a suffix match: "claude-opus-4-6" -> "anthropic/claude-opus-4-6:beta"
  const suffix = entries.find((e) => {
    const tail = e.id.toLowerCase().split('/').pop() ?? '';
    return tail === lower || tail.startsWith(`${lower}:`);
  });
  return suffix ? toQuote(suffix, 'cross-reference') : null;
}

function toQuote(entry: CatalogueEntry, basis: PriceQuote['basis']): PriceQuote {
  return {
    matchedId: entry.id,
    basis,
    ...(entry.promptPerM !== undefined ? { promptPerM: entry.promptPerM } : {}),
    ...(entry.completionPerM !== undefined ? { completionPerM: entry.completionPerM } : {}),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.cacheReadPerM !== undefined ? { cacheReadPerM: entry.cacheReadPerM } : {}),
    ...(entry.cacheWritePerM !== undefined ? { cacheWritePerM: entry.cacheWritePerM } : {}),
  };
}

function perMillion(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Number((n * 1_000_000).toFixed(4));
}
