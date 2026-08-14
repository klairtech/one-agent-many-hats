/**
 * Operational learnings (paper §4, "new lessons, on the go").
 *
 * A lesson is a rule the system established for itself from experience. Three properties
 * bound the damage when the experience was adversarial or simply wrong: scoping, staged
 * promotion through canary, and confidence arithmetic. A fourth — this file's
 * `assertBehavioural` — caps what a lesson may ever say.
 */

import path from 'node:path';

import { HatsError } from '../core/errors.js';
import { appendJsonl, newId, readJsonl, rewriteJsonl, utcStamp } from '../core/store.js';
import type { Lesson, LessonScope, LessonSource } from './types.js';

/** Injected in this share of runs while on canary. Deterministic per run id, not random. */
const CANARY_SHARE = 0.5;
const PROMOTE_AFTER_ACCEPTS = 2;
const EXPIRE_AFTER_SILENT_RUNS = 6;
const DISABLE_BELOW_CONFIDENCE = 0.2;

/**
 * rule/lessons-behavioural-only, enforced at **write** time.
 *
 * A lesson store that contains access-widening text and merely declines to apply it is one
 * refactor away from applying it. These patterns are deliberately broad; the cost of a
 * false positive is that a legitimate phrasing is refused and the user rewords it.
 */
const ACCESS_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /\b(allow|enable|grant|permit|unlock|whitelist|allowlist)\b[^.]{0,60}\b(tool|network|fetch|profile|write|command|shell|sandbox|permission|access|egress)\b/i,
    why: 'it tries to widen the action surface',
  },
  {
    re: /\b(disable|bypass|skip|ignore|suppress|turn off|work around)\b[^.]{0,60}\b(gate|guard|guardian|rule|check|approval|review|validation|scope|boundary|confirmation)\b/i,
    why: 'it tries to weaken an enforcement point',
  },
  {
    re: /\b(trusted|assisted)\b[^.]{0,40}\bprofile\b|--profile\b|\bprofile\s*[:=]/i,
    why: 'the profile is not model-selectable (rule/profile-not-model-selectable)',
  },
  {
    re: /\bignore\b[^.]{0,40}\b(previous|prior|earlier|above|system)\b[^.]{0,20}\b(instruction|prompt|rule)/i,
    why: 'it is an instruction-override, not a working preference',
  },
  {
    re: /\b(outside|beyond|above)\b[^.]{0,30}\b(workspace|root|directory)\b|\.\.\/\.\.\//,
    why: 'it refers to paths outside the workspace (rule/workspace-scope)',
  },
  {
    // A run once failed with egress off and wrote "when network egress is disabled, do not
    // attempt fetch_url". The user then turned egress on, and the agent kept asserting it
    // had no network and refused to try — while fetch_url sat in its allowlist. A lesson
    // that records the state of the config is wrong the moment the config changes, and it
    // is worse than useless because it suppresses the capability.
    // [Seen in a live run, 2026-08-14.]
    re: /\b(network|egress|internet|api key|credential|profile|tool)\b[^.]{0,40}\b(is|are|was|were)\b[^.]{0,20}\b(off|on|disabled|enabled|unavailable|not available|missing|absent)\b/i,
    why:
      'it records the state of the configuration, which changes. Your tool list is ' +
      'authoritative at the time you run — check it rather than remembering it',
  },
];

export function assertBehavioural(text: string): void {
  for (const { re, why } of ACCESS_PATTERNS) {
    if (re.test(text)) {
      throw new HatsError(
        'LESSON_REFUSED',
        `refused to store this lesson: ${why}. Lessons shape how the agent works, never what it may touch.`,
        { text: text.slice(0, 300), pattern: String(re) },
        'rule/lessons-behavioural-only',
      );
    }
  }
}

export class LessonStore {
  constructor(private readonly file: string) {}

  static forWorkspace(workspaceDir: string): LessonStore {
    return new LessonStore(path.join(workspaceDir, 'memory', 'lessons.jsonl'));
  }

  async all(): Promise<Lesson[]> {
    return readJsonl<Lesson>(this.file);
  }

  /**
   * Records a lesson. Explicit corrections enter active at high confidence (paper §4:
   * "an explicit correction becomes a high-confidence lesson verbatim"); everything
   * distilled from a failure starts as a draft and has to earn its way in.
   */
  async record(input: {
    text: string;
    scope: LessonScope;
    source: LessonSource;
    runId: string;
    tags?: string[];
  }): Promise<Lesson> {
    const text = input.text.trim();
    if (!text) throw new HatsError('LESSON_REFUSED', 'empty lesson', {});
    assertBehavioural(text);

    const existing = (await this.all()).find((l) => similar(l.text, text) && l.scope === input.scope);
    if (existing) {
      return this.update(existing.id, (l) => ({
        ...l,
        confidence: clamp(l.confidence + 0.1),
        injectedRuns: [...new Set([...l.injectedRuns, input.runId])].slice(-50),
        updatedAt: utcStamp(),
      }));
    }

    const now = utcStamp();
    const correction = input.source === 'correction';
    const lesson: Lesson = {
      id: newId('les'),
      text,
      scope: input.scope,
      status: correction ? 'active' : 'draft',
      confidence: correction ? 0.9 : 0.5,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      injectedRuns: [],
      matches: 0,
      accepts: 0,
      rejects: 0,
      tags: (input.tags ?? []).map((t) => t.toLowerCase()),
    };
    await appendJsonl(this.file, lesson);
    return lesson;
  }

  /**
   * Lessons for a run, ranked by confidence and tag match.
   *
   * Canary staging happens here: a draft/canary lesson is injected only into a
   * deterministic share of runs, so the runs without it are the control group.
   */
  async select(opts: { runId: string; query: string; limit: number }): Promise<Lesson[]> {
    const all = await this.all();
    const queryTokens = new Set(tokenise(opts.query));
    const eligible: Array<{ lesson: Lesson; score: number }> = [];

    for (const lesson of all) {
      if (lesson.status === 'disabled') continue;
      if (lesson.confidence < DISABLE_BELOW_CONFIDENCE) continue;
      if (lesson.status !== 'active' && !inCanarySlice(opts.runId, lesson.id)) continue;

      const tagHit = lesson.tags.filter((t) => queryTokens.has(t)).length;
      const textHit = tokenise(lesson.text).filter((t) => queryTokens.has(t)).length;
      const score = lesson.confidence * 2 + tagHit * 1.5 + Math.min(textHit, 4) * 0.25;
      eligible.push({ lesson, score });
    }

    return eligible
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit)
      .map((e) => e.lesson);
  }

  /** Called once per run with the lessons that were actually injected. */
  async markInjected(ids: string[], runId: string, matched: string[] = []): Promise<void> {
    if (ids.length === 0) return;
    const all = await this.all();
    const matchedSet = new Set(matched);
    const updated = all.map((l) =>
      ids.includes(l.id)
        ? {
            ...l,
            injectedRuns: [...new Set([...l.injectedRuns, runId])].slice(-50),
            matches: l.matches + (matchedSet.has(l.id) ? 1 : 0),
            updatedAt: utcStamp(),
          }
        : l,
    );
    await rewriteJsonl(this.file, updated.map((l) => this.applyLifecycle(l)));
  }

  /**
   * Feedback arithmetic. Acceptance strengthens, rejection weakens, and a lesson that
   * keeps being contradicted is disabled rather than argued with.
   */
  async applyFeedback(runId: string, verdict: 'accepted' | 'rejected'): Promise<Lesson[]> {
    const all = await this.all();
    const touched: Lesson[] = [];
    const updated = all.map((l) => {
      if (!l.injectedRuns.includes(runId)) return l;
      const next: Lesson = {
        ...l,
        accepts: l.accepts + (verdict === 'accepted' ? 1 : 0),
        rejects: l.rejects + (verdict === 'rejected' ? 1 : 0),
        confidence: clamp(l.confidence + (verdict === 'accepted' ? 0.12 : -0.25)),
        updatedAt: utcStamp(),
      };
      const staged = this.applyLifecycle(next);
      touched.push(staged);
      return staged;
    });
    await rewriteJsonl(this.file, updated);
    return touched;
  }

  async update(id: string, fn: (l: Lesson) => Lesson): Promise<Lesson> {
    const all = await this.all();
    let result: Lesson | undefined;
    const updated = all.map((l) => {
      if (l.id !== id) return l;
      result = this.applyLifecycle(fn(l));
      return result;
    });
    if (!result) throw new HatsError('REGISTRY_NOT_FOUND', `no lesson ${id}`, {});
    await rewriteJsonl(this.file, updated);
    return result;
  }

  async setStatus(id: string, status: Lesson['status'], reason?: string): Promise<Lesson> {
    return this.update(id, (l) => ({
      ...l,
      status,
      retiredReason: status === 'disabled' ? (reason ?? 'disabled by hand') : l.retiredReason,
      updatedAt: utcStamp(),
    }));
  }

  /**
   * The canary evaluator (paper §4): concrete signals only — acceptance, rejection,
   * whether the lesson ever matched, and how many runs it has been silent for.
   */
  private applyLifecycle(l: Lesson): Lesson {
    if (l.status === 'disabled') return l;

    if (l.confidence < DISABLE_BELOW_CONFIDENCE || l.rejects >= 3) {
      return { ...l, status: 'disabled', retiredReason: 'contradicted by outcomes' };
    }
    if (l.status === 'draft' && l.injectedRuns.length >= 1) {
      return { ...l, status: 'canary' };
    }
    if (l.status === 'canary') {
      if (l.accepts >= PROMOTE_AFTER_ACCEPTS && l.confidence >= 0.6) {
        return { ...l, status: 'active' };
      }
      if (l.injectedRuns.length >= EXPIRE_AFTER_SILENT_RUNS && l.matches === 0) {
        return { ...l, status: 'disabled', retiredReason: 'never matched — expired as noise' };
      }
    }
    return l;
  }
}

/** Deterministic canary slice: same run + same lesson always decide the same way. */
function inCanarySlice(runId: string, lessonId: string): boolean {
  let h = 2166136261;
  const key = `${runId}:${lessonId}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100) / 100 < CANARY_SHARE;
}

function similar(a: string, b: string): boolean {
  const ta = new Set(tokenise(a));
  const tb = new Set(tokenise(b));
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size) > 0.7;
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((t) => t.length > 2);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(3))));
}
