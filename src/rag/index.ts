/**
 * The document index: hybrid retrieval over a workspace.
 *
 * Two rankers, fused. BM25 catches the exact identifier, the error string, the flag name —
 * the things a user types verbatim and embeddings are famously mediocre at. Vectors catch
 * the paraphrase. Reciprocal rank fusion combines them without needing the two scores to
 * be on a comparable scale, which they are not.
 *
 * If no embedding model is configured it still works, in keyword mode, and **says so in
 * every result**. Implying an understanding it does not have would be worse than being
 * limited.
 *
 * ADR-0003 still applies: no vector database. A workspace is thousands of chunks, cosine
 * over them is a few milliseconds, and a service to run would be a service to run.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import type { HatsConfig } from '../core/config.js';
import { Logger, nullLogger } from '../core/logger.js';
import { workspaceDir } from '../core/paths.js';
import { appendJsonl, ensureDir, exists, readJson, readJsonl, shortHash, utcStamp, writeJsonAtomic } from '../core/store.js';
import type { ChatProvider } from '../providers/types.js';
import { chunkDocument, citation, type Chunk } from './chunk.js';

export * from './chunk.js';

export interface IndexedChunk extends Chunk {
  /** Present only when an embedding model was available at index time. */
  embedding?: number[];
  /** Content hash of the source file, so a rebuild can skip unchanged files. */
  fileHash: string;
}

export interface IndexMeta {
  builtAt: string;
  files: number;
  chunks: number;
  /** null means the index is keyword-only. */
  embedModel: string | null;
  dimensions: number | null;
  /** path -> content hash, for incremental rebuilds. */
  hashes: Record<string, string>;
}

export interface SearchHit {
  chunk: IndexedChunk;
  score: number;
  citation: string;
  /** Which ranker found it — surfaced to the model, not hidden. */
  matched: 'both' | 'keyword' | 'semantic';
}

export interface SearchResult {
  hits: SearchHit[];
  mode: 'hybrid' | 'keyword';
  /** The sentence the tool puts in front of the model when there are no embeddings. */
  caveat: string | null;
  indexedChunks: number;
}

const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.zsh',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env.example',
  '.sql', '.graphql', '.proto', '.html', '.css', '.scss', '.vue', '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__',
  '.venv', 'venv', '.next', '.nuxt', 'coverage', '.cache', '.turbo', 'Pods', '.hats-test-home',
]);

const MAX_FILE_BYTES = 1024 * 1024;
const K_RRF = 60;

export class DocumentIndex {
  private chunks: IndexedChunk[] = [];
  private meta: IndexMeta | null = null;

  constructor(
    private readonly dir: string,
    private readonly logger: Logger = nullLogger,
  ) {}

  static forWorkspace(slug: string, logger: Logger = nullLogger): DocumentIndex {
    return new DocumentIndex(path.join(workspaceDir(slug), 'index'), logger);
  }

  private get chunksFile(): string {
    return path.join(this.dir, 'chunks.jsonl');
  }
  private get metaFile(): string {
    return path.join(this.dir, 'meta.json');
  }

  async load(): Promise<boolean> {
    if (this.meta) return true;
    if (!(await exists(this.metaFile))) return false;
    this.meta = await readJson<IndexMeta | null>(this.metaFile, null);
    this.chunks = await readJsonl<IndexedChunk>(this.chunksFile);
    return this.meta !== null;
  }

  async status(): Promise<IndexMeta | null> {
    await this.load();
    return this.meta;
  }

  /**
   * Walks the workspace, chunks what it can read, and embeds if a model is available.
   * Unchanged files are skipped on rebuild — re-embedding a repo because one file moved
   * is how people end up never rebuilding.
   */
  async build(opts: {
    root: string;
    config: HatsConfig;
    embedder?: ChatProvider | undefined;
    embedModel?: string | undefined;
    onProgress?: (message: string) => void;
  }): Promise<IndexMeta> {
    const previous = (await this.load()) ? this.meta : null;
    const files = await collectFiles(opts.root);
    opts.onProgress?.(`${files.length} files to consider`);

    const kept: IndexedChunk[] = [];
    const hashes: Record<string, string> = {};
    const reusable = new Map<string, IndexedChunk[]>();
    for (const chunk of this.chunks) {
      const list = reusable.get(chunk.path) ?? [];
      list.push(chunk);
      reusable.set(chunk.path, list);
    }

    let reused = 0;
    const fresh: IndexedChunk[] = [];

    for (const file of files) {
      const rel = path.relative(opts.root, file);
      let text: string;
      try {
        text = await fsp.readFile(file, 'utf8');
      } catch {
        continue;
      }
      if (looksBinary(text)) continue;

      const hash = shortHash(text);
      hashes[rel] = hash;

      // Reuse only when the file is unchanged AND the stored chunks are as good as what
      // we would produce now. Without the second condition, turning embeddings on for the
      // first time reuses every existing chunk unembedded, and semantic search silently
      // covers only whatever happened to change that day.
      // [Found by reading the output of a real rebuild, 2026-08-14.]
      const prior = reusable.get(rel);
      const asGoodAsNew = !opts.embedder?.embed || (prior ?? []).every((c) => c.embedding?.length);
      if (prior && previous?.hashes[rel] === hash && asGoodAsNew) {
        kept.push(...prior);
        reused++;
        continue;
      }
      const chunks = chunkDocument(rel, text, {
        maxChars: opts.config.rag.chunkChars,
        overlapChars: opts.config.rag.overlapChars,
      });
      fresh.push(...chunks.map((c) => ({ ...c, fileHash: hash })));
    }

    opts.onProgress?.(`${reused} files unchanged, ${fresh.length} new chunks`);

    let dimensions: number | null = previous?.dimensions ?? null;
    if (opts.embedder?.embed && fresh.length > 0) {
      const batch = 32;
      for (let i = 0; i < fresh.length; i += batch) {
        const slice = fresh.slice(i, i + batch);
        try {
          const vectors = await opts.embedder.embed(slice.map((c) => embedText(c)));
          slice.forEach((chunk, j) => {
            const v = vectors[j];
            if (v && v.length > 0) {
              chunk.embedding = v;
              dimensions = v.length;
            }
          });
        } catch (e) {
          // Losing embeddings degrades to keyword mode; losing the index does not happen.
          this.logger.warn('rag.embed.failed', { error: (e as Error).message });
          opts.onProgress?.(`embedding failed (${(e as Error).message}) — continuing keyword-only`);
          break;
        }
        opts.onProgress?.(`embedded ${Math.min(i + batch, fresh.length)}/${fresh.length}`);
      }
    }

    this.chunks = [...kept, ...fresh];
    this.meta = {
      builtAt: utcStamp(),
      files: Object.keys(hashes).length,
      chunks: this.chunks.length,
      embedModel: this.chunks.some((c) => c.embedding) ? (opts.embedModel ?? 'configured') : null,
      dimensions,
      hashes,
    };

    await ensureDir(this.dir);
    await fsp.rm(this.chunksFile, { force: true });
    for (const chunk of this.chunks) await appendJsonl(this.chunksFile, chunk);
    await writeJsonAtomic(this.metaFile, this.meta);
    return this.meta;
  }

  async search(
    query: string,
    limit: number,
    embedder?: ChatProvider | undefined,
  ): Promise<SearchResult> {
    await this.load();
    if (this.chunks.length === 0) {
      return { hits: [], mode: 'keyword', caveat: null, indexedChunks: 0 };
    }

    const keyword = bm25(query, this.chunks);
    let semantic: Array<{ chunk: IndexedChunk; score: number }> = [];

    const haveVectors = this.chunks.some((c) => c.embedding?.length);
    if (haveVectors && embedder?.embed) {
      try {
        const [vector] = await embedder.embed([query]);
        if (vector?.length) {
          semantic = this.chunks
            .filter((c) => c.embedding?.length === vector.length)
            .map((chunk) => ({ chunk, score: cosine(vector, chunk.embedding ?? []) }))
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit * 4);
        }
      } catch (e) {
        this.logger.warn('rag.query.embed.failed', { error: (e as Error).message });
      }
    }

    const mode: 'hybrid' | 'keyword' = semantic.length > 0 ? 'hybrid' : 'keyword';
    const fused = fuse(keyword.slice(0, limit * 4), semantic, limit);

    return {
      hits: fused,
      mode,
      caveat:
        mode === 'keyword'
          ? 'Keyword matching only — no embedding model is configured, so these results match wording rather than meaning. Treat a miss as "not phrased that way", not as "not present".'
          : null,
      indexedChunks: this.chunks.length,
    };
  }
}

/** Reciprocal rank fusion: combines two rankings without comparing their scores. */
function fuse(
  keyword: Array<{ chunk: IndexedChunk; score: number }>,
  semantic: Array<{ chunk: IndexedChunk; score: number }>,
  limit: number,
): SearchHit[] {
  const scores = new Map<string, { chunk: IndexedChunk; score: number; inK: boolean; inS: boolean }>();

  keyword.forEach((entry, rank) => {
    const current = scores.get(entry.chunk.id) ?? { chunk: entry.chunk, score: 0, inK: false, inS: false };
    current.score += 1 / (K_RRF + rank + 1);
    current.inK = true;
    scores.set(entry.chunk.id, current);
  });
  semantic.forEach((entry, rank) => {
    const current = scores.get(entry.chunk.id) ?? { chunk: entry.chunk, score: 0, inK: false, inS: false };
    current.score += 1 / (K_RRF + rank + 1);
    current.inS = true;
    scores.set(entry.chunk.id, current);
  });

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => ({
      chunk: e.chunk,
      score: Number(e.score.toFixed(5)),
      citation: citation(e.chunk),
      matched: e.inK && e.inS ? 'both' : e.inK ? 'keyword' : 'semantic',
    }));
}

function embedText(chunk: Chunk): string {
  const trail = chunk.headings.length > 0 ? `${chunk.headings.join(' > ')}\n` : '';
  return `${chunk.path}\n${trail}${chunk.text}`.slice(0, 6_000);
}

function bm25(query: string, chunks: IndexedChunk[]): Array<{ chunk: IndexedChunk; score: number }> {
  const terms = tokenise(query);
  if (terms.length === 0) return [];
  const docs = chunks.map((c) => tokenise(`${c.path} ${c.headings.join(' ')} ${c.text}`));
  const avg = docs.reduce((a, d) => a + d.length, 0) / (docs.length || 1);

  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);

  const k1 = 1.2;
  const b = 0.75;
  return chunks
    .map((chunk, i) => {
      const doc = docs[i] ?? [];
      const counts = new Map<string, number>();
      for (const t of doc) counts.set(t, (counts.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of terms) {
        const f = counts.get(term);
        if (!f) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / (avg || 1))));
      }
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score);
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.$-]+/)
    .flatMap((t) => (t.includes('.') && t.length > 3 ? [t, ...t.split('.')] : [t]))
    .filter((t) => t.length > 1 && t.length < 40);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [root];
  while (queue.length > 0 && out.length < 20_000) {
    const dir = queue.shift();
    if (!dir) break;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fsp.stat(full).catch(() => null);
      if (!stat || stat.size > MAX_FILE_BYTES || stat.size === 0) continue;
      out.push(full);
    }
  }
  return out.sort();
}

function looksBinary(sample: string): boolean {
  const head = sample.slice(0, 1_000);
  if (head.includes('\u0000')) return true;
  let control = 0;
  for (let i = 0; i < head.length; i++) {
    const code = head.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) control++;
  }
  return head.length > 0 && control / head.length > 0.1;
}
