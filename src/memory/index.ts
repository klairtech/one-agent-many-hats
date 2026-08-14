/**
 * The memory facade: compose before a run, distil after it, and rewrite retrieval when
 * the user gives feedback (paper §5, §4).
 *
 * "An autonomous system that starts every run without memory is not autonomous; it has no
 * continuity." Equally: memory is a liability as well as an asset, so every layer here is
 * workspace-scoped, minimised to conclusions rather than transcripts, and reversible by
 * feedback.
 */

import path from 'node:path';

import type { HatsConfig } from '../core/config.js';
import { isHatsError } from '../core/errors.js';
import { Logger, nullLogger } from '../core/logger.js';
import { workspaceDir } from '../core/paths.js';
import type { ProviderPool } from '../providers/index.js';
import { LessonStore } from './lessons.js';
import { OrgContext } from './orgcontext.js';
import { PersonaStore } from './persona.js';
import { TakeawayStore } from './takeaways.js';
import type { ComposedMemory, Lesson, RetrievalHit } from './types.js';

export * from './types.js';
export { LessonStore, assertBehavioural } from './lessons.js';
export { TakeawayStore } from './takeaways.js';
export { PersonaStore } from './persona.js';
export { OrgContext, ORG_CONTEXT_TEMPLATE } from './orgcontext.js';

export interface DistillInput {
  runId: string;
  question: string;
  answer: string;
  /** Concrete signals the distiller reasons over — not the whole transcript. */
  signals: {
    ok: boolean;
    deniedTools: string[];
    failedTools: string[];
    gateFailures: string[];
    steps: number;
    stepBudget: number;
    sandboxDescriptors: string[];
  };
}

export interface DistillResult {
  takeawayId?: string;
  lessons: Lesson[];
  personaFact?: string;
  refused: string[];
  usedModel: boolean;
}

export class MemoryLayers {
  readonly lessons: LessonStore;
  readonly takeaways: TakeawayStore;
  readonly persona: PersonaStore;
  readonly org: OrgContext;
  readonly dir: string;

  constructor(
    private readonly slug: string,
    private readonly config: HatsConfig,
    private readonly pool?: ProviderPool,
    private readonly logger: Logger = nullLogger,
  ) {
    this.dir = workspaceDir(slug);
    this.lessons = LessonStore.forWorkspace(this.dir);
    this.takeaways = TakeawayStore.forWorkspace(this.dir);
    this.persona = PersonaStore.forWorkspace(this.dir, config.memory.personaMaxChars);
    this.org = OrgContext.forWorkspace(this.dir);
  }

  get memoryDir(): string {
    return path.join(this.dir, 'memory');
  }

  /** MemoryAccess, for the recall_memory tool. */
  async recall(query: string, limit: number): Promise<RetrievalHit[]> {
    return this.takeaways.search(query, limit, await this.embed(query));
  }

  /**
   * Builds the memory block for the system prompt. Layers are ordered by authority:
   * authored context outranks inferred persona, which outranks retrieved experience.
   */
  async compose(query: string, runId: string): Promise<ComposedMemory> {
    const [org, persona, hits, lessons] = await Promise.all([
      this.org.read(),
      this.persona.get(),
      this.takeaways.search(query, this.config.memory.takeawayTopK, await this.embed(query)),
      this.lessons.select({ runId, query, limit: this.config.memory.lessonTopK }),
    ]);

    const empty: string[] = [];
    const parts: string[] = [];

    if (org) parts.push(`## Workspace context (authored by the user — authoritative)\n\n${org}`);
    else empty.push('org-context');

    if (persona.summary) {
      parts.push(
        `## What I have noticed about this user (inferred, may be stale — defer to anything they say now)\n\n${persona.summary}`,
      );
    } else empty.push('persona');

    if (hits.length > 0) {
      parts.push(
        `## From earlier runs in this workspace\n\n` +
          hits.map((h) => `- ${h.text.replace(/\n/g, '\n  ')}`).join('\n'),
      );
    } else empty.push('takeaways');

    if (lessons.length > 0) {
      parts.push(
        `## Operational learnings (things I got wrong before)\n\n` +
          lessons
            .map((l) => `- [${l.status}, confidence ${l.confidence.toFixed(2)}] ${l.text}`)
            .join('\n'),
      );
    } else empty.push('lessons');

    await this.lessons.markInjected(
      lessons.map((l) => l.id),
      runId,
      lessons.filter((l) => l.tags.some((t) => query.toLowerCase().includes(t))).map((l) => l.id),
    );

    return {
      block: parts.join('\n\n'),
      lessonIds: lessons.map((l) => l.id),
      takeawayIds: [],
      emptyLayers: empty,
    };
  }

  /**
   * Post-run distillation. Uses the light tier when one is configured; falls back to a
   * mechanical takeaway when there is no model or the model returns nonsense, because
   * losing continuity is worse than losing nuance.
   */
  async distill(input: DistillInput): Promise<DistillResult> {
    const result: DistillResult = { lessons: [], refused: [], usedModel: false };
    if (!this.config.memory.distill) return result;

    await this.persona.noteRun();

    const distilled = await this.askModelToDistil(input).catch((e) => {
      this.logger.warn('memory.distill.failed', { error: (e as Error).message });
      return null;
    });

    const takeaway = distilled?.takeaway ?? {
      question: input.question,
      answer: input.answer.slice(0, 400),
    };
    result.usedModel = Boolean(distilled);

    const stored = await this.takeaways.add({
      runId: input.runId,
      question: takeaway.question,
      answer: takeaway.answer,
      tags: distilled?.tags ?? [],
      ...(await this.embedOrNothing(`${takeaway.question} ${takeaway.answer}`)),
    });
    result.takeawayId = stored.id;

    for (const proposed of distilled?.lessons ?? []) {
      try {
        const lesson = await this.lessons.record({
          text: proposed.text,
          scope: proposed.scope === 'global' ? 'global' : 'workspace',
          source: 'failure',
          runId: input.runId,
          tags: proposed.tags ?? [],
        });
        result.lessons.push(lesson);
      } catch (e) {
        if (isHatsError(e) && e.code === 'LESSON_REFUSED') {
          // Refusals are recorded, not silently dropped: a refused lesson is a signal.
          this.logger.warn('memory.lesson.refused', {
            runId: input.runId,
            reason: e.message,
            text: proposed.text.slice(0, 200),
          });
          result.refused.push(proposed.text);
          continue;
        }
        throw e;
      }
    }

    if (distilled?.personaFact) {
      await this.persona.addFact(distilled.personaFact);
      result.personaFact = distilled.personaFact;
    }

    this.logger.info('memory.distilled', {
      runId: input.runId,
      takeawayId: result.takeawayId,
      lessons: result.lessons.length,
      refused: result.refused.length,
      usedModel: result.usedModel,
    });
    return result;
  }

  /**
   * The standing correction channel. Acceptance strengthens what was injected; rejection
   * weakens it; an explicit correction becomes a high-confidence lesson verbatim.
   */
  async feedback(
    runId: string,
    verdict: 'accepted' | 'rejected' | 'corrected',
    note?: string,
  ): Promise<{ takeawaysTouched: number; lessonsTouched: number; lessonAdded?: Lesson }> {
    const takeawaysTouched = await this.takeaways.setFeedback(runId, verdict, note);
    const lessonsTouched =
      verdict === 'corrected'
        ? (await this.lessons.applyFeedback(runId, 'rejected')).length
        : (await this.lessons.applyFeedback(runId, verdict)).length;

    let lessonAdded: Lesson | undefined;
    if (verdict === 'corrected' && note?.trim()) {
      lessonAdded = await this.lessons.record({
        text: note.trim(),
        scope: 'workspace',
        source: 'correction',
        runId,
      });
    }
    return { takeawaysTouched, lessonsTouched, ...(lessonAdded ? { lessonAdded } : {}) };
  }

  private async embed(text: string): Promise<number[] | undefined> {
    if (!this.config.memory.embeddings || !this.pool) return undefined;
    const provider = this.pool.embedder();
    if (!provider?.embed) return undefined;
    try {
      const [vector] = await provider.embed([text]);
      return vector;
    } catch {
      return undefined;
    }
  }

  private async embedOrNothing(text: string): Promise<{ embedding?: number[] }> {
    const embedding = await this.embed(text);
    return embedding ? { embedding } : {};
  }

  private async askModelToDistil(input: DistillInput): Promise<{
    takeaway: { question: string; answer: string };
    lessons: Array<{ text: string; scope: string; tags?: string[] }>;
    personaFact?: string;
    tags?: string[];
  } | null> {
    if (!this.pool) return null;
    const { provider, model } = this.pool.resolve('light');

    const response = await provider.chat({
      model,
      system: DISTIL_SYSTEM,
      messages: [{ role: 'user', content: renderDistilPrompt(input) }],
      tools: [],
      temperature: 0,
      maxTokens: 700,
    });

    const parsed = extractJson(response.text);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const takeaway = obj['takeaway'] as Record<string, unknown> | undefined;
    if (!takeaway || typeof takeaway['answer'] !== 'string') return null;

    const lessons = Array.isArray(obj['lessons'])
      ? (obj['lessons'] as unknown[])
          .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
          .map((l) => ({
            text: String(l['text'] ?? '').trim(),
            scope: String(l['scope'] ?? 'workspace'),
            tags: Array.isArray(l['tags']) ? (l['tags'] as unknown[]).map(String) : [],
          }))
          .filter((l) => l.text.length > 10)
      : [];

    return {
      takeaway: {
        question: String(takeaway['question'] ?? input.question),
        answer: String(takeaway['answer']),
      },
      lessons,
      ...(typeof obj['persona_fact'] === 'string' && obj['persona_fact'].trim()
        ? { personaFact: String(obj['persona_fact']) }
        : {}),
      tags: Array.isArray(obj['tags']) ? (obj['tags'] as unknown[]).map(String) : [],
    };
  }
}

const DISTIL_SYSTEM = `You distil one completed agent run into durable memory. You are not answering the question; you are deciding what is worth remembering.

Reply with ONE JSON object and nothing else:

{
  "takeaway": { "question": "<the request in one line>", "answer": "<the conclusion in 1-2 sentences>" },
  "tags": ["<3-6 lowercase keywords>"],
  "lessons": [ { "text": "<a working-practice lesson>", "scope": "workspace", "tags": ["..."] } ],
  "persona_fact": "<one short sentence about how this user works, or omit>"
}

Rules for lessons — they are the part that changes future behaviour, so be strict:
- Propose one ONLY if something actually went wrong: a denial, a failed gate, a wasted approach, a correction. A run that went fine yields no lessons.
- A lesson is about HOW to work: which tool to reach for, what to check first, what to avoid. Never about what the agent may access.
- Never propose anything that would allow, enable, grant, bypass, disable or skip a tool, a profile, a gate, an approval or a boundary. Such lessons are refused and wasted.
- Concrete and short. "Search before reading in this repo; the source lives under src/, not lib/" beats "be more careful".
- Zero lessons is the common and correct answer.`;

function renderDistilPrompt(input: DistillInput): string {
  const s = input.signals;
  return [
    `REQUEST: ${input.question}`,
    ``,
    `ANSWER DELIVERED: ${input.answer.slice(0, 1_500)}`,
    ``,
    `SIGNALS:`,
    `- completed: ${s.ok}`,
    `- steps used: ${s.steps} of ${s.stepBudget}`,
    `- tools denied: ${s.deniedTools.join(', ') || 'none'}`,
    `- tools failed: ${s.failedTools.join(', ') || 'none'}`,
    `- gates failed: ${s.gateFailures.join(', ') || 'none'}`,
    `- sandbox computations: ${s.sandboxDescriptors.join('; ') || 'none'}`,
  ].join('\n');
}

/** Models wrap JSON in prose and fences no matter what you tell them. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
