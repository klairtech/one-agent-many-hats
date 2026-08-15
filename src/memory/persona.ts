/**
 * The user persona (paper §5, layer 2).
 *
 * "It is intentionally modest: a compact sketch that is useful when right and harmless
 * when stale, not a dossier." Size-bounded by construction, distilled a sentence at a
 * time, and never a place for anything that would matter if it were wrong.
 */

import path from 'node:path';

import { readJson, utcStamp, writeJsonAtomic } from '../core/store.js';
import type { Persona } from './types.js';

const EMPTY: Persona = { summary: '', facts: [], runCount: 0, updatedAt: '' };

/**
 * True when a "fact about the user" is really a fact about the configuration. Deliberately
 * narrow: it must mention a capability *and* a state word, so "the user works offline a
 * lot" survives while "network egress is disabled in this workspace" does not.
 */
export function describesEnvironment(text: string): boolean {
  return (
    /\b(network|egress|internet|online|offline|fetch_url|api key|credential|profile|workspace config|configuration|tool(?:s)? (?:list|available))\b/i.test(
      text,
    ) &&
    /\b(off|on|disabled|enabled|unavailable|not available|missing|absent|configured|installed|set up|constrain|restrict|blocked|denied)\w*\b/i.test(
      text,
    )
  );
}

export class PersonaStore {
  constructor(
    private readonly file: string,
    private readonly maxChars: number,
  ) {}

  /** So the panel can say where this lives, like it already does for the org note. */
  get path(): string {
    return this.file;
  }

  static forWorkspace(workspaceDir: string, maxChars: number): PersonaStore {
    return new PersonaStore(path.join(workspaceDir, 'memory', 'persona.json'), maxChars);
  }

  async get(): Promise<Persona> {
    return readJson<Persona>(this.file, EMPTY);
  }

  /**
   * Adds one distilled fact. Oldest facts are dropped when the budget is exceeded, which
   * makes the persona a moving window over recent behaviour rather than an accumulating
   * profile — deliberate, and the reason it stays harmless when stale.
   */
  async addFact(fact: string): Promise<Persona> {
    const trimmed = fact.trim().replace(/\s+/g, ' ');
    if (!trimmed) return this.get();
    // The persona describes the *person*, not the machine. A run that failed with egress
    // off wrote "clarify workspace constraints before accepting research requests" here,
    // and every later run then refused to try fetch_url — while fetch_url was sitting in
    // its allowlist. Environment state changes; a persona fact does not, so recording one
    // permanently suppresses a capability the user has since enabled.
    // [Seen in a live run, 2026-08-14.]
    if (describesEnvironment(trimmed)) return this.get();
    const current = await this.get();

    const facts = [...current.facts.filter((f) => !overlaps(f, trimmed)), trimmed];
    while (facts.join(' ').length > this.maxChars && facts.length > 1) facts.shift();

    const next: Persona = {
      summary: facts.join(' '),
      facts,
      runCount: current.runCount,
      updatedAt: utcStamp(),
    };
    await writeJsonAtomic(this.file, next);
    return next;
  }

  async noteRun(): Promise<Persona> {
    const current = await this.get();
    const next: Persona = { ...current, runCount: current.runCount + 1, updatedAt: utcStamp() };
    await writeJsonAtomic(this.file, next);
    return next;
  }

  /**
   * Drop one inferred fact.
   *
   * Needed because the persona is inferred from what the user *did*, and a run that was a
   * test, a one-off, or somebody else at the keyboard produces a fact that is simply wrong
   * about them — and then quietly steers every future run. Clearing the whole persona to
   * remove one wrong sentence costs all the right ones, so nobody does it.
   */
  async forgetFact(fact: string): Promise<Persona> {
    const current = await this.get();
    const facts = current.facts.filter((f) => f !== fact);
    if (facts.length === current.facts.length) return current;
    const next: Persona = {
      summary: facts.join(' '),
      facts,
      runCount: current.runCount,
      updatedAt: utcStamp(),
    };
    await writeJsonAtomic(this.file, next);
    return next;
  }

  async clear(): Promise<void> {
    await writeJsonAtomic(this.file, EMPTY);
  }
}

/** Crude near-duplicate check so the persona does not repeat itself in six phrasings. */
function overlaps(a: string, b: string): boolean {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) > 0.6;
}
