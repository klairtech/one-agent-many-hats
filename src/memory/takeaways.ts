/**
 * Retrieved memory (paper §5, layer 3).
 *
 * "Takeaways are kept intentionally brief: memory should carry experience, while analysis
 * is always re-run fresh against current data." So this stores conclusions, never
 * transcripts, and retrieval is filtered by feedback — a rejected answer never comes back,
 * and a corrected one comes back in its corrected form.
 *
 * Ranking is BM25 over the local corpus (ADR-0003: a laptop's takeaway store is hundreds
 * of short strings; a vector service would be a dependency and a daemon for nothing).
 * Embeddings are used instead when the configured provider offers them.
 */

import path from 'node:path';

import { appendJsonl, newId, readJsonl, rewriteJsonl, utcStamp } from '../core/store.js';
import { tokenise } from './lessons.js';
import type { FeedbackVerdict, RetrievalHit, Takeaway } from './types.js';

const K1 = 1.2;
const B = 0.75;

export class TakeawayStore {
  constructor(private readonly file: string) {}

  static forWorkspace(workspaceDir: string): TakeawayStore {
    return new TakeawayStore(path.join(workspaceDir, 'memory', 'takeaways.jsonl'));
  }

  async all(): Promise<Takeaway[]> {
    return readJsonl<Takeaway>(this.file);
  }

  async add(input: {
    runId: string;
    question: string;
    answer: string;
    tags?: string[];
    embedding?: number[];
  }): Promise<Takeaway> {
    const takeaway: Takeaway = {
      id: newId('tak'),
      runId: input.runId,
      question: input.question.trim().slice(0, 400),
      answer: input.answer.trim().slice(0, 800),
      createdAt: utcStamp(),
      feedback: 'none',
      tags: (input.tags ?? []).map((t) => t.toLowerCase()),
      ...(input.embedding ? { embedding: input.embedding } : {}),
    };
    await appendJsonl(this.file, takeaway);
    return takeaway;
  }

  /** Feedback rewrites retrieval: this is the mechanism, not a metric. */
  async setFeedback(runId: string, verdict: FeedbackVerdict, correction?: string): Promise<number> {
    const all = await this.all();
    let touched = 0;
    const updated = all.map((t) => {
      if (t.runId !== runId) return t;
      touched++;
      return {
        ...t,
        feedback: verdict,
        ...(correction ? { correction } : {}),
      };
    });
    if (touched > 0) await rewriteJsonl(this.file, updated);
    return touched;
  }

  async search(
    query: string,
    limit: number,
    queryEmbedding?: number[],
  ): Promise<RetrievalHit[]> {
    const all = (await this.all()).filter((t) => t.feedback !== 'rejected');
    if (all.length === 0) return [];

    const scored =
      queryEmbedding && all.some((t) => t.embedding?.length)
        ? all.map((t) => ({ t, score: cosine(queryEmbedding, t.embedding ?? []) }))
        : bm25(query, all);

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ t, score }) => ({
        text: render(t),
        source: t.feedback === 'corrected' ? `${t.id} (corrected)` : t.id,
        score,
      }));
  }
}

/** A corrected takeaway returns as its correction — the original never resurfaces. */
function render(t: Takeaway): string {
  if (t.feedback === 'corrected' && t.correction) {
    return `Q: ${t.question}\nA (corrected by the user): ${t.correction}`;
  }
  return `Q: ${t.question}\nA: ${t.answer}`;
}

function bm25(query: string, docs: Takeaway[]): Array<{ t: Takeaway; score: number }> {
  const queryTerms = tokenise(query);
  const corpus = docs.map((t) => tokenise(`${t.question} ${t.answer} ${t.tags.join(' ')}`));
  const avgLen = corpus.reduce((a, d) => a + d.length, 0) / (corpus.length || 1);

  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  return docs.map((t, i) => {
    const doc = corpus[i] ?? [];
    const counts = new Map<string, number>();
    for (const term of doc) counts.set(term, (counts.get(term) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const f = counts.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.length) / (avgLen || 1))));
    }
    // Accepted answers are worth slightly more than unrated ones.
    if (t.feedback === 'accepted') score *= 1.15;
    return { t, score };
  });
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
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
