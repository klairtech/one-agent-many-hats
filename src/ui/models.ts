/**
 * Local model management: what is installed, install another, remove one.
 *
 * What is genuinely available, and what is not, because this is a place where it would be
 * easy to fake something:
 *
 *   - **Installed / install / remove** are real Ollama endpoints (`/api/tags`,
 *     `/api/pull`, `/api/delete`). Pull streams progress, so the UI shows a real bar.
 *   - **Searching the Ollama library is not an API.** ollama.com/library is a website, and
 *     scraping it would break the first time they change a class name. So there is a
 *     curated shortlist here, honestly labelled as a shortlist, plus a free-text field
 *     that accepts any name — including ones not on the list.
 *   - **Hugging Face search is a real API**, and Ollama can pull a GGUF straight from it
 *     with `hf.co/{user}/{repo}:{quant}`. That path is offered, and it needs tool network
 *     egress to be on, because it is an outbound request to a third party.
 */

import { HatsError } from '../core/errors.js';

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  modifiedAt?: string;
  /** From /api/show — the real thing, not a guess. */
  contextLength?: number;
  /** e.g. ["completion","tools","vision"]. `tools` is the one that matters here. */
  capabilities?: string[];
}

export interface CatalogueVariant {
  /** The exact ref you would pull, e.g. "qwen2.5:14b". */
  name: string;
  params: string;
  /** Live from the registry manifest; null when the ref could not be resolved. */
  sizeBytes: number | null;
}

export interface CatalogueFamily {
  family: string;
  publisher: string;
  /** What it is for, in one line. */
  note: string;
  /** Whether this runtime cares: does the family support tool calling? */
  tools: 'yes' | 'no' | 'unknown';
  role: 'agent' | 'embedding' | 'vision' | 'reasoning';
  variants: CatalogueVariant[];
}

export interface Suggestion {
  name: string;
  note: string;
  approxGb: number;
  /** Whether it can drive the agent loop, or is only useful for the index. */
  role: 'agent' | 'embedding';
}

/**
 * A shortlist, not a catalogue. Chosen for one property that matters here more than
 * benchmark scores: whether the model reliably emits tool calls, because a model that
 * cannot will fall back to the text protocol and be noticeably worse at everything.
 */
export const SUGGESTED: Suggestion[] = [
  { name: 'qwen2.5:7b', note: 'Solid tool calling. The default I would start with on a laptop.', approxGb: 4.7, role: 'agent' },
  { name: 'qwen2.5:14b', note: 'Better judgement if you have the memory for it.', approxGb: 9, role: 'agent' },
  { name: 'qwen2.5:3b', note: 'Fast and small. Tool calling gets shakier.', approxGb: 1.9, role: 'agent' },
  { name: 'llama3.1:8b', note: 'Tool calling, widely used.', approxGb: 4.7, role: 'agent' },
  { name: 'mistral-nemo', note: 'Tool calling, long context.', approxGb: 7, role: 'agent' },
  { name: 'gemma3:4b', note: 'No native tool calling — hats degrades to the text protocol.', approxGb: 3.3, role: 'agent' },
  { name: 'nomic-embed-text', note: 'Embeddings for semantic search. Not an agent model.', approxGb: 0.27, role: 'embedding' },
  { name: 'mxbai-embed-large', note: 'Larger embeddings, better recall on long documents.', approxGb: 0.67, role: 'embedding' },
];

/**
 * The library, by family.
 *
 * Ollama publishes no endpoint that lists its library — [VERIFIED 2026-08-14: the
 * docker-style `/v2/library/<name>/tags/list` returns 404] — so the *names* here are
 * curated and this list is not exhaustive. Everything else about them is live: sizes come
 * from the registry manifest per ref, and once a model is installed its context length and
 * capabilities are read from Ollama rather than from anything written here.
 *
 * The `tools` flag is the field that matters most for this runtime, because a model without
 * tool calling falls back to the prompt protocol and is markedly worse at everything. It is
 * marked `unknown` wherever it has not been confirmed, and the UI shows the confirmed
 * capability from /api/show once the model is on disk.
 */
export const CATALOGUE: CatalogueFamily[] = [
  {
    family: 'Qwen 2.5', publisher: 'Alibaba', role: 'agent', tools: 'yes',
    note: 'Reliable tool calling at small sizes. The one to start with on a laptop.',
    variants: [
      { name: 'qwen2.5:3b', params: '3B', sizeBytes: null },
      { name: 'qwen2.5:7b', params: '7B', sizeBytes: null },
      { name: 'qwen2.5:14b', params: '14B', sizeBytes: null },
      { name: 'qwen2.5:32b', params: '32B', sizeBytes: null },
    ],
  },
  {
    family: 'Qwen 3', publisher: 'Alibaba', role: 'agent', tools: 'yes',
    note: 'Newer Qwen generation with a thinking mode.',
    variants: [
      { name: 'qwen3:4b', params: '4B', sizeBytes: null },
      { name: 'qwen3:8b', params: '8B', sizeBytes: null },
      { name: 'qwen3:14b', params: '14B', sizeBytes: null },
      { name: 'qwen3:30b', params: '30B', sizeBytes: null },
    ],
  },
  {
    family: 'Llama 3.1', publisher: 'Meta', role: 'agent', tools: 'yes',
    note: 'Widely used, well understood, solid tool calling.',
    variants: [
      { name: 'llama3.1:8b', params: '8B', sizeBytes: null },
      { name: 'llama3.1:70b', params: '70B', sizeBytes: null },
    ],
  },
  {
    family: 'Llama 3.2', publisher: 'Meta', role: 'agent', tools: 'yes',
    note: 'Small models for constrained machines.',
    variants: [
      { name: 'llama3.2:1b', params: '1B', sizeBytes: null },
      { name: 'llama3.2:3b', params: '3B', sizeBytes: null },
    ],
  },
  {
    family: 'Mistral Nemo', publisher: 'Mistral', role: 'agent', tools: 'yes',
    note: 'Long context with tool calling.',
    variants: [{ name: 'mistral-nemo:latest', params: '12B', sizeBytes: null }],
  },
  {
    family: 'Mistral', publisher: 'Mistral', role: 'agent', tools: 'yes',
    note: 'The classic 7B; small and quick.',
    variants: [{ name: 'mistral:latest', params: '7B', sizeBytes: null }],
  },
  {
    family: 'Phi 4', publisher: 'Microsoft', role: 'agent', tools: 'unknown',
    note: 'Strong reasoning for its size.',
    variants: [{ name: 'phi4:latest', params: '14B', sizeBytes: null }],
  },
  {
    family: 'Gemma 3', publisher: 'Google', role: 'vision', tools: 'no',
    note: 'No native tool calling — hats degrades to the prompt protocol. Handles images.',
    variants: [
      { name: 'gemma3:1b', params: '1B', sizeBytes: null },
      { name: 'gemma3:4b', params: '4B', sizeBytes: null },
      { name: 'gemma3:12b', params: '12B', sizeBytes: null },
      { name: 'gemma3:27b', params: '27B', sizeBytes: null },
    ],
  },
  {
    family: 'DeepSeek R1', publisher: 'DeepSeek', role: 'reasoning', tools: 'unknown',
    note: 'Reasoning model; thinks at length before answering.',
    variants: [
      { name: 'deepseek-r1:7b', params: '7B', sizeBytes: null },
      { name: 'deepseek-r1:8b', params: '8B', sizeBytes: null },
      { name: 'deepseek-r1:14b', params: '14B', sizeBytes: null },
      { name: 'deepseek-r1:32b', params: '32B', sizeBytes: null },
    ],
  },
  {
    family: 'Qwen 2.5 Coder', publisher: 'Alibaba', role: 'agent', tools: 'yes',
    note: 'Tuned for code. Good for the change and investigate skills.',
    variants: [
      { name: 'qwen2.5-coder:7b', params: '7B', sizeBytes: null },
      { name: 'qwen2.5-coder:14b', params: '14B', sizeBytes: null },
      { name: 'qwen2.5-coder:32b', params: '32B', sizeBytes: null },
    ],
  },
  {
    family: 'Granite 3', publisher: 'IBM', role: 'agent', tools: 'yes',
    note: 'Small models built with tool use in mind.',
    variants: [
      { name: 'granite3.3:2b', params: '2B', sizeBytes: null },
      { name: 'granite3.3:8b', params: '8B', sizeBytes: null },
    ],
  },
  {
    family: 'Nomic Embed', publisher: 'Nomic', role: 'embedding', tools: 'no',
    note: 'Embeddings for semantic search. Set it as embedModel, not as a tier.',
    variants: [{ name: 'nomic-embed-text:latest', params: '137M', sizeBytes: null }],
  },
  {
    family: 'MxBai Embed', publisher: 'MixedBread', role: 'embedding', tools: 'no',
    note: 'Larger embeddings; better recall on long documents.',
    variants: [{ name: 'mxbai-embed-large:latest', params: '335M', sizeBytes: null }],
  },
];

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
  percent?: number;
}

export class OllamaAdmin {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async reachable(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/api/tags'), { signal: AbortSignal.timeout(3_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async installed(): Promise<InstalledModel[]> {
    const res = await fetch(this.url('/api/tags'), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new HatsError('PROVIDER_ERROR', `ollama: HTTP ${res.status}`, {});
    const body = (await res.json()) as {
      models?: Array<{
        name?: string;
        size?: number;
        modified_at?: string;
        details?: { parameter_size?: string; quantization_level?: string; family?: string };
      }>;
    };
    return (body.models ?? [])
      .filter((m): m is { name: string } & typeof m => typeof m.name === 'string')
      .map((m) => ({
        name: m.name,
        sizeBytes: m.size ?? 0,
        ...(m.details?.parameter_size ? { parameterSize: m.details.parameter_size } : {}),
        ...(m.details?.quantization_level ? { quantization: m.details.quantization_level } : {}),
        ...(m.details?.family ? { family: m.details.family } : {}),
        ...(m.modified_at ? { modifiedAt: m.modified_at } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Enriches the tag list with what /api/show knows: real context length and real
   * capabilities. `tools` in that list is the difference between a model that drives this
   * runtime properly and one that limps along on the prompt protocol, so it is worth the
   * extra local call per model.
   */
  async installedDetailed(): Promise<InstalledModel[]> {
    const base = await this.installed();
    return Promise.all(
      base.map(async (m) => {
        try {
          const res = await fetch(this.url('/api/show'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: m.name }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return m;
          const body = (await res.json()) as {
            capabilities?: string[];
            model_info?: Record<string, unknown>;
          };
          const info = body.model_info ?? {};
          const ctxKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
          const ctx = ctxKey ? Number(info[ctxKey]) : undefined;
          return {
            ...m,
            ...(Array.isArray(body.capabilities) ? { capabilities: body.capabilities } : {}),
            ...(Number.isFinite(ctx) ? { contextLength: ctx as number } : {}),
          };
        } catch {
          return m; // a model that will not describe itself is still installed
        }
      }),
    );
  }

  /** Streams NDJSON progress. The callback fires per line so the UI can show a real bar. */
  async pull(model: string, onProgress: (p: PullProgress) => void): Promise<void> {
    assertModelName(model);
    const res = await fetch(this.url('/api/pull'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new HatsError('PROVIDER_ERROR', `ollama pull: HTTP ${res.status}`, { model });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let parsed: { status?: string; completed?: number; total?: number; error?: string };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.error) throw new HatsError('PROVIDER_ERROR', `ollama pull: ${parsed.error}`, { model });
        const percent =
          parsed.total && parsed.completed ? Math.round((parsed.completed / parsed.total) * 100) : undefined;
        onProgress({
          status: parsed.status ?? 'working',
          ...(parsed.completed !== undefined ? { completed: parsed.completed } : {}),
          ...(parsed.total !== undefined ? { total: parsed.total } : {}),
          ...(percent !== undefined ? { percent } : {}),
        });
      }
    }
  }

  async remove(model: string): Promise<void> {
    assertModelName(model);
    const res = await fetch(this.url('/api/delete'), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      throw new HatsError('PROVIDER_ERROR', `ollama delete: HTTP ${res.status}`, { model });
    }
  }
}

/**
 * Download size for a model that is not installed yet, from the registry manifest.
 * [VERIFIED 2026-08-14] `/v2/library/<name>/manifests/<tag>` returns layer sizes that sum
 * to the real download — 4.36 GB for qwen2.5:7b — and errors cleanly for a name that does
 * not exist, which is what makes it safe to show a number rather than a guess.
 */
export async function remoteSize(ref: string): Promise<number | null> {
  const [name, tag = 'latest'] = ref.split(':');
  if (!name || name.includes('/')) return null; // namespaced refs are not in the library
  try {
    const res = await fetch(
      `https://registry.ollama.ai/v2/library/${encodeURIComponent(name)}/manifests/${encodeURIComponent(tag)}`,
      {
        headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { layers?: Array<{ size?: number }>; errors?: unknown };
    if (body.errors || !body.layers) return null;
    const total = body.layers.reduce((a, l) => a + (l.size ?? 0), 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

const sizeCache = new Map<string, number | null>();

/** The catalogue with live sizes filled in. Sizes are cached for the process lifetime. */
export async function catalogueWithSizes(): Promise<CatalogueFamily[]> {
  const refs = CATALOGUE.flatMap((f) => f.variants.map((v) => v.name)).filter((r) => !sizeCache.has(r));

  // Bounded concurrency: this is a third-party registry, not something to hammer.
  const batch = 8;
  for (let i = 0; i < refs.length; i += batch) {
    const slice = refs.slice(i, i + batch);
    const sizes = await Promise.all(slice.map((r) => remoteSize(r)));
    slice.forEach((r, j) => sizeCache.set(r, sizes[j] ?? null));
  }

  return CATALOGUE.map((f) => ({
    ...f,
    variants: f.variants.map((v) => ({ ...v, sizeBytes: sizeCache.get(v.name) ?? null })),
  }));
}

export interface HfModel {
  id: string;
  downloads: number;
  likes: number;
  /** The reference Ollama understands, once a quantisation is chosen. */
  pullHint: string;
}

/**
 * Hugging Face model search, restricted to GGUF — the only format Ollama can pull.
 * This is an outbound request to a third party, so the caller must have decided that
 * tool network egress is acceptable; the UI gates it behind the same switch.
 */
export async function searchHuggingFace(query: string, limit = 15): Promise<HfModel[]> {
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('search', query);
  url.searchParams.set('filter', 'gguf');
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(Math.min(limit, 30)));

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new HatsError('PROVIDER_ERROR', `huggingface: HTTP ${res.status}`, {});
  }
  const body = (await res.json()) as Array<{ id?: string; downloads?: number; likes?: number }>;
  return body
    .filter((m): m is { id: string } & typeof m => typeof m.id === 'string')
    .map((m) => ({
      id: m.id,
      downloads: m.downloads ?? 0,
      likes: m.likes ?? 0,
      pullHint: `hf.co/${m.id}`,
    }));
}

/**
 * Model names reach a shell-free HTTP body, but they also end up in file paths inside
 * Ollama. Keep them to the character set Ollama actually uses rather than trusting that.
 */
function assertModelName(model: string): void {
  if (!/^[A-Za-z0-9._\/:-]{1,200}$/.test(model)) {
    throw new HatsError('TOOL_INPUT_INVALID', `"${model}" is not a valid model name`, { model });
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${bytes} B`;
}
