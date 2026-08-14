/**
 * ADR-0007 and ADR-0009, in code. Every run with no human at the approval prompt goes
 * through here, and neither the scheduler nor the messaging channel builds its own
 * `approve` callback.
 *
 * There are now three ways a call can be allowed, and the order matters because it goes
 * from most-considered to least-available:
 *
 *   1. a standing grant a human scoped in advance (ADR-0009)
 *   2. the schedule's own allowTools list (ADR-0007 §4, the coarse option)
 *   3. asking the human on their channel and waiting for a yes
 *
 * There is deliberately no fourth. This module contains no path that returns `true` for a
 * call nobody authorised, and no flag, config key or override that produces one.
 */

import type { Profile } from '../core/config.js';
import { HatsError } from '../core/errors.js';
import type { ApprovalRequest, ClarificationRequest } from '../tools/types.js';
import { checkGrants, consumeGrant } from './grants.js';

/** Who or what caused an unattended run. Recorded so the audit trail keeps its person. */
export interface Trigger {
  kind: 'schedule' | 'message';
  /** Schedule id, or channel:sender. */
  id: string;
  /** The human this is attributable to: the schedule's author, or the message sender. */
  actor: string;
}

export interface UnattendedDecision {
  tool: string;
  headline: string;
  allowed: boolean;
  /** How it was allowed, when it was. Absent on a denial. */
  via?: 'grant' | 'allow-list' | 'asked';
  reason: string;
  at: string;
}

/**
 * Asks a human out of band and waits. Supplied by the caller when a channel is configured;
 * absent means there is nobody to ask, which is the normal case.
 */
export type RemoteApprover = (
  request: ApprovalRequest,
  trigger: Trigger,
) => Promise<{ approved: boolean; by?: string; reason: string }>;

export interface UnattendedPolicy {
  profile: Profile;
  /** Tools pre-authorised by a human when the schedule was created. */
  allowTools: string[];
  trigger: Trigger;
  workspace: string;
  /** Set when the human can be reached to approve something mid-run. */
  askHuman?: RemoteApprover;
}

/**
 * `trusted` means "approval pre-granted for the session" (ADR-0005). An unattended run has
 * no session and nobody who granted anything, so the setting is refused rather than
 * reinterpreted. Called at schedule-creation time, while a human is still present to read
 * the error.
 */
export function assertUnattendedProfile(profile: Profile): asserts profile is Profile {
  if (profile === 'trusted') {
    throw new HatsError(
      'CONFIG_INVALID',
      'an unattended run cannot use the trusted profile: trusted means approval pre-granted ' +
        'for a session, and there is no session and no human to grant it. Use read-only, or ' +
        'assisted with a standing grant (hats grant add) or an explicit --allow-tool list.',
      { profile, adr: 'ADR-0007' },
      'rule/mutation-requires-approval',
    );
  }
}

/**
 * The approval callback for an unattended run.
 *
 * Denies by default and records every decision with how it was reached. A denial is not an
 * error — the run continues exactly as it does when a person says no, which is what lets a
 * read-only monitor report what it *would* have done.
 */
export function unattendedApprover(
  policy: UnattendedPolicy,
  decisions: UnattendedDecision[],
): (r: ApprovalRequest) => Promise<boolean> {
  const allow = new Set(policy.allowTools);

  return async (request: ApprovalRequest) => {
    const record = (allowed: boolean, reason: string, via?: UnattendedDecision['via']) => {
      decisions.push({
        tool: request.tool,
        headline: request.headline,
        allowed,
        ...(via ? { via } : {}),
        reason,
        at: new Date().toISOString(),
      });
      return allowed;
    };

    // 1. A standing grant, scoped in advance by a human who stated why.
    // Handler facts first, arguments second: what the model asked for always wins, so a
    // handler cannot quietly redirect the scope check away from the real target.
    const args = { ...(request.scope ?? {}), ...(request.args ?? {}) };
    const grant = await checkGrants(request.tool, args, policy.workspace).catch(() => null);
    if (grant?.allowed && grant.grant) {
      // Consumed only once the call is actually authorised, so a check that goes nowhere
      // does not burn the budget.
      await consumeGrant(grant.grant).catch(() => undefined);
      return record(true, grant.reason, 'grant');
    }

    // 2. The schedule's own list. Coarser — it names a tool, not a scope.
    if (allow.has(request.tool)) {
      return record(
        true,
        `pre-authorised by ${policy.trigger.actor} when ${policy.trigger.kind} ${policy.trigger.id} was created`,
        'allow-list',
      );
    }

    // 3. Ask the human, if there is a way to reach them, and wait.
    if (policy.askHuman) {
      try {
        const answer = await policy.askHuman(request, policy.trigger);
        return record(
          answer.approved,
          answer.approved
            ? `approved by ${answer.by ?? policy.trigger.actor} when asked`
            : answer.reason,
          answer.approved ? 'asked' : undefined,
        );
      } catch (e) {
        return record(false, `could not reach anyone to approve it: ${(e as Error).message}`);
      }
    }

    const why = grant && !grant.allowed ? grant.reason : 'no standing grant covers it';
    return record(false, `nobody was present to approve it and ${why}`);
  };
}

/**
 * The clarification callback. A run that needs to ask a question stops and surfaces it
 * rather than guessing — an unattended guess produces an answer nobody checks.
 */
export function unattendedAsker(): (r: ClarificationRequest) => Promise<string> {
  return async (request: ClarificationRequest) => {
    throw new HatsError(
      'CLARIFICATION_REQUIRED',
      `the run needs a decision and nobody is here to make it: ${request.question}`,
      { question: request.question, ...(request.options ? { options: request.options } : {}) },
    );
  };
}

/** One line for the run record and the panel, so a denial is never silent. */
export function summariseDecisions(decisions: UnattendedDecision[]): string {
  if (decisions.length === 0) return '';
  const denied = decisions.filter((d) => !d.allowed);
  const byGrant = decisions.filter((d) => d.via === 'grant');
  const byList = decisions.filter((d) => d.via === 'allow-list');
  const byAsk = decisions.filter((d) => d.via === 'asked');

  const bits: string[] = [];
  if (byGrant.length) bits.push(`${byGrant.length} call(s) ran under a standing grant: ${names(byGrant)}`);
  if (byList.length) bits.push(`${byList.length} pre-authorised call(s) ran: ${names(byList)}`);
  if (byAsk.length) bits.push(`${byAsk.length} call(s) ran after you approved them: ${names(byAsk)}`);
  if (denied.length) {
    bits.push(`${denied.length} call(s) were blocked: ${names(denied)}`);
  }
  return bits.join('. ') + '.';
}

function names(decisions: UnattendedDecision[]): string {
  return [...new Set(decisions.map((d) => d.tool))].join(', ');
}
