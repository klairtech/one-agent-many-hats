/**
 * Checks for the failures a model cannot see from the inside.
 *
 * From 726 unattended runs of one model across 18 real tasks, the fatal errors were almost
 * never reasoning errors. They were clerical, and they were invisible to the agent that
 * made them:
 *
 *   - a single wrong character in a path. The tool reported "written", the agent reported
 *     "done", and everything downstream referred to a file nobody would ever find.
 *   - "done" meaning nothing: 11 of 12 customers processed, reported as 144 of 144.
 *   - ambiguity resolved destructively: asked to merge two folders, it deleted one.
 *
 * None of these are fixed by a better model, because none of them look like mistakes from
 * where the model stands. The agent believed each one. So they are checked by code that
 * compares the claim against what the tools actually did, which is the one vantage point
 * the model does not have.
 */

import path from 'node:path';

import type { ToolObservation } from '../tools/types.js';

export interface ClaimCheck {
  ok: boolean;
  detail: string;
}

/** Words that assert a whole set was handled. The ones that turn 11 into 12. */
const COMPLETION = /\b(all|every|each|both|complete[d]?|entire|whole|fully|everything|no remaining|none left|nothing left)\b/i;

/**
 * Does the draft claim it finished everything, when the evidence says otherwise?
 *
 * The dangerous shape is a completeness word next to a count: "all 144 records",
 * "processed every customer". If a tool reported a different total, the answer is wrong in
 * the specific way nobody downstream will notice — it reads as success.
 *
 * Deliberately narrow. It fires when a completeness claim carries a number that no
 * observation supports, not on every use of the word "all", because a gate that fires on
 * ordinary prose gets switched off within a week.
 */
export function completionClaimed(draft: string, observations: ToolObservation[]): ClaimCheck {
  const failed = observations.filter((o) => !o.ok);
  const sentences = draft.split(/(?<=[.!?])\s+|\n/).filter((s) => COMPLETION.test(s));
  if (sentences.length === 0) return { ok: true, detail: 'no completeness claim to check' };

  // A completeness claim while tools were failing is the exact combination that produced
  // "all 144 records complete" after 11 of 12 customers.
  if (failed.length > 0) {
    const claim = sentences[0]?.trim().slice(0, 160) ?? '';
    return {
      ok: false,
      detail:
        `the answer claims completeness ("${claim}") but ${failed.length} tool call(s) failed ` +
        `in this run (${[...new Set(failed.map((f) => f.tool))].join(', ')}). Either say which ` +
        `part did not complete, or verify the whole set before claiming it.`,
    };
  }

  return { ok: true, detail: `${sentences.length} completeness claim(s), no failed tool calls` };
}

/**
 * A path that is one keystroke away from a sibling that already exists.
 *
 * `reports/summary.md` written as `reports/sumary.md` succeeds. The directory is right, the
 * permissions are right, the tool says "written", and the file is gone as far as anyone
 * looking for it is concerned. The only clue available at write time is that a very similar
 * name already exists next to it.
 *
 * Returns the suspected intended name, or null.
 */
export function nearMiss(target: string, siblings: string[]): string | null {
  const name = path.basename(target);
  // Measured on the stem: "a.md" is four characters but a one-character name, and every
  // short name is one edit from every other short name. Comparing those produces noise,
  // and a warning that fires on nothing is worse than no warning.
  if (path.basename(name, path.extname(name)).length < 4) return null;
  for (const sibling of siblings) {
    if (sibling === name) return null; // exact: overwriting on purpose
  }
  for (const sibling of siblings) {
    if (Math.abs(sibling.length - name.length) > 1) continue;
    if (editDistanceWithin(name.toLowerCase(), sibling.toLowerCase(), 1)) return sibling;
  }
  return null;
}

/** True when `a` and `b` differ by at most `max` single-character edits. */
export function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > max) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= max;
}

/**
 * Was this target ever read before being destroyed or overwritten?
 *
 * Asked to merge two customer folders, a run deleted one of them and reported the task
 * complete. Ambiguity does not make an agent hesitate — it makes it commit, and it commits
 * to whichever reading it formed first.
 *
 * The invariant that catches this without trying to understand intent: **you may not
 * destroy what you never looked at.** Merging requires reading both sides. Deleting
 * something you never opened is either a mistake or a decision that deserves a human.
 */
export function destroyingUnread(
  target: string,
  observations: ToolObservation[],
): ClaimCheck {
  const base = path.basename(target);
  const read = observations.some(
    (o) =>
      o.ok &&
      ['read_file', 'list_dir', 'search_files', 'search_documents'].includes(o.tool) &&
      (o.summary.includes(target) || o.summary.includes(base)),
  );
  if (read) return { ok: true, detail: `${target} was read first` };
  return {
    ok: false,
    detail:
      `nothing in this run read "${target}" before destroying or overwriting it. ` +
      `Read it first — if the instruction was ambiguous, the reading you formed may not be ` +
      `the one that was meant, and this is the step where that becomes irreversible.`,
  };
}

/**
 * Is the run going in circles?
 *
 * Two runs of the same task: one carried on until a hard crash forced a rethink, the other
 * revised at step 140 of 151. In both, the signs were there far earlier. A human slows down
 * when things feel off; there is no "feels off" here, so the loop has to notice on the
 * model's behalf.
 *
 * Two signals, both cheap: the same call repeated, and a run of consecutive failures.
 */
export function stalled(
  observations: ToolObservation[],
  window = 4,
): { stalled: boolean; reason: string } {
  const recent = observations.slice(-window);
  if (recent.length < window) return { stalled: false, reason: '' };

  const consecutiveFailures = recent.every((o) => !o.ok);
  if (consecutiveFailures) {
    return {
      stalled: true,
      reason:
        `the last ${window} tool calls all failed (${[...new Set(recent.map((r) => r.tool))].join(', ')}). ` +
        `Stop and change approach rather than continuing: say what you were trying to establish, ` +
        `what is blocking it, and either try a different route or report what you could not do.`,
    };
  }

  // The artifact id is stamped onto the front of every summary and is unique per call, so
  // comparing raw summaries meant two identical calls never looked identical and this check
  // could not fire at all. Strip it before comparing.
  // [Found by a test that expected a stuck run to stop and watched it run to the ceiling.]
  const signatures = recent.map(
    (o) => `${o.tool}:${o.summary.replace(/\[art_[a-f0-9]+\]\s*/g, '').slice(0, 80)}`,
  );
  if (new Set(signatures).size === 1) {
    return {
      stalled: true,
      reason:
        `the last ${window} tool calls were identical (${recent[0]?.tool}) and returned the same ` +
        `result. Repeating it again will not change the answer — change what you are asking, or ` +
        `report what this evidence does and does not support.`,
    };
  }
  return { stalled: false, reason: '' };
}
