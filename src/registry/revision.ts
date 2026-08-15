/**
 * What a revision may change, and what it may not.
 *
 * Revising a *skill* is safe by construction: a skill only ever recomposes tools that
 * already exist, and the executor intersects its list with the profile and the registry, so
 * the worst a bad revision does is make the agent work badly. That is recoverable and
 * visible.
 *
 * Revising a *rule* is different in kind, and it is the reason this file exists. Rules are
 * the boundary. A revision that changes `strength: gate` to `strength: prompt` does not
 * make a worse rule — it removes the enforcement entirely, leaving a paragraph of advice
 * where a check used to be, and it looks like an ordinary edit while doing it. Same for
 * repointing `enforced_by` at a different gate, which silently detaches the rule from the
 * code that holds it.
 *
 * This is the ADR-0010 argument one level up: the agent may improve what a rule *says*, and
 * may not change what a rule *enforces*. Sharpening the statement, adding history, tightening
 * scope — all fine, and all the things a rule learned from experience actually needs.
 */

import { HatsError } from '../core/errors.js';
import type { Rule, RuleStrength } from './types.js';

/** prompt < gate < code. A revision may climb this ladder, never descend it. */
const STRENGTH: Record<RuleStrength, number> = { prompt: 0, gate: 1, code: 2 };

export interface RevisionCheck {
  ok: boolean;
  detail: string;
}

export function checkRuleRevision(current: Rule, revised: Rule): RevisionCheck {
  if (STRENGTH[revised.strength] < STRENGTH[current.strength]) {
    return {
      ok: false,
      detail:
        `${current.id} is enforced at strength "${current.strength}" and the revision lowers it to ` +
        `"${revised.strength}". A rule may be promoted up the ladder (prompt -> gate -> code) as ` +
        `evidence accumulates, never demoted: demoting one removes the enforcement while leaving ` +
        `text that still reads like a rule. If the rule is wrong, say so and let a person retire it.`,
    };
  }

  if (current.enforcedBy && revised.enforcedBy !== current.enforcedBy) {
    return {
      ok: false,
      detail:
        `${current.id} is held by ${current.enforcedBy} and the revision points it at ` +
        `${revised.enforcedBy ?? 'nothing'}. The enforcement point is the code that actually stops ` +
        `the thing; repointing it detaches the rule from its check without changing a word of what ` +
        `the rule appears to say.`,
    };
  }

  if (revised.onViolation !== current.onViolation && current.onViolation !== 'warn') {
    return {
      ok: false,
      detail:
        `${current.id} responds to a violation with "${current.onViolation}" and the revision ` +
        `changes that to "${revised.onViolation}". That is the difference between stopping the run ` +
        `and mentioning it, which is not a wording change.`,
    };
  }

  return { ok: true, detail: `strength, enforcement point and response are unchanged` };
}

export function assertRuleRevision(current: Rule, revised: Rule): void {
  const check = checkRuleRevision(current, revised);
  if (!check.ok) {
    throw new HatsError('REGISTRY_IMMUTABLE', check.detail, {
      id: current.id,
      was: current.strength,
      proposed: revised.strength,
    });
  }
}
