/**
 * The artifact store and the result shaper.
 *
 * Paper §2.5 / §2.6.3: the model receives a summary; the full result becomes an artifact
 * with an id and stored provenance. Two consequences, and the second is the one people
 * miss: context stays bounded, and values cannot be laundered — a number in the answer is
 * either in an artifact or it was invented, and `check_consistency` can tell which.
 */

import path from 'node:path';

import { ensureDir, newId, readJson, utcStamp, writeJsonAtomic } from '../core/store.js';
import fsp from 'node:fs/promises';

export type ArtifactKind = 'tool-result' | 'derived' | 'sandbox' | 'draft';

export interface Artifact {
  id: string;
  runId: string;
  kind: ArtifactKind;
  tool: string;
  createdAt: string;
  /** What the model saw. Bounded. */
  summary: string;
  /** What the record keeps. Unbounded. */
  payload: unknown;
  /** Inputs and formula for derived values; source path/args for reads. */
  provenance: Record<string, unknown>;
}

export interface ArtifactRef {
  id: string;
  tool: string;
  summary: string;
}

export class ArtifactStore {
  private readonly index = new Map<string, Artifact>();

  constructor(
    private readonly dir: string,
    private readonly runId: string,
  ) {}

  async put(input: {
    kind: ArtifactKind;
    tool: string;
    summary: string;
    payload: unknown;
    provenance?: Record<string, unknown>;
  }): Promise<Artifact> {
    const artifact: Artifact = {
      id: newId('art'),
      runId: this.runId,
      kind: input.kind,
      tool: input.tool,
      createdAt: utcStamp(),
      summary: input.summary,
      payload: input.payload,
      provenance: input.provenance ?? {},
    };
    this.index.set(artifact.id, artifact);
    await ensureDir(this.dir);
    await writeJsonAtomic(path.join(this.dir, `${artifact.id}.json`), artifact);
    return artifact;
  }

  /**
   * Stores bytes next to the JSON artifacts — a screenshot, a downloaded file. The payload
   * records the filename rather than the content, so the transcript never carries a
   * megabyte of base64 into the model's context.
   */
  async putBinary(
    tool: string,
    bytes: Buffer,
    extension: string,
    provenance: Record<string, unknown> = {},
  ): Promise<string> {
    const id = newId('art');
    await ensureDir(this.dir);
    const file = path.join(this.dir, `${id}.${extension}`);
    await fsp.writeFile(file, bytes);
    const artifact: Artifact = {
      id,
      runId: this.runId,
      kind: 'tool-result',
      tool,
      createdAt: utcStamp(),
      summary: `${bytes.length} bytes stored as ${id}.${extension}`,
      payload: { file: `${id}.${extension}`, bytes: bytes.length },
      provenance,
    };
    this.index.set(id, artifact);
    await writeJsonAtomic(path.join(this.dir, `${id}.json`), artifact);
    return id;
  }

  async get(id: string): Promise<Artifact | undefined> {
    const cached = this.index.get(id);
    if (cached) return cached;
    const loaded = await readJson<Artifact | null>(path.join(this.dir, `${id}.json`), null);
    if (loaded) this.index.set(id, loaded);
    return loaded ?? undefined;
  }

  /** In-run artifacts, newest last. The gates and `check_consistency` read this. */
  all(): Artifact[] {
    return [...this.index.values()];
  }

  refs(): ArtifactRef[] {
    return this.all().map((a) => ({ id: a.id, tool: a.tool, summary: a.summary }));
  }

  async loadAll(): Promise<Artifact[]> {
    try {
      const files = await fsp.readdir(this.dir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const a = await readJson<Artifact | null>(path.join(this.dir, f), null);
        if (a) this.index.set(a.id, a);
      }
    } catch {
      /* no artifacts yet */
    }
    return this.all();
  }
}

export interface ShapedResult {
  summary: string;
  truncated: boolean;
  originalChars: number;
}

/**
 * Bounds an observation. Truncation says what was dropped and how to get it, because a
 * bounded observation that is not actionable just costs a step (rule/tool-result-bounds).
 */
export function shapeText(text: string, maxChars: number, hint?: string): ShapedResult {
  if (text.length <= maxChars) {
    return { summary: text, truncated: false, originalChars: text.length };
  }
  const head = text.slice(0, maxChars);
  const dropped = text.length - maxChars;
  const guidance = hint ? ` ${hint}` : '';
  return {
    summary: `${head}\n\n[truncated: ${dropped} of ${text.length} characters not shown.${guidance}]`,
    truncated: true,
    originalChars: text.length,
  };
}

/** Compact one-line description of an arbitrary value, for summaries of structured data. */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array of ${value.length}`;
  switch (typeof value) {
    case 'object':
      return `object{${Object.keys(value as object).slice(0, 8).join(',')}}`;
    case 'string':
      return `string(${value.length} chars)`;
    default:
      return String(value);
  }
}
