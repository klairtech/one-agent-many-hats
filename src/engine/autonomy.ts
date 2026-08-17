/**
 * Autonomy: how much of self-extension happens without a human (ADR-0006, 0010, 0011).
 *
 * The original line was drawn between *recomposition* and *capability*. A skill or a rule
 * can only rearrange tools that already exist, so promoting one cannot let the agent do
 * anything it could not already do; a tool was different in kind, and needed a person.
 *
 * ADR-0011 moved that line, because the argument underneath it was never really about
 * tools. It was about *declarations nothing checked*: a self-written spec could claim
 * `mutating: false` on a handler that deleted files. A generated tool now runs in a process
 * started with the flags its own spec earned it, so the claim is enforced before the code
 * exists. Once the declaration cannot lie, a new tool stops being a different kind of thing.
 *
 * The levels are a ladder, not an enum. Each capability names the rung it needs, and every
 * rung above keeps everything below it — which was a real bug before: `self-healing` was
 * checked with `!== 'adaptive'`, so raising the level to get patch-repair silently switched
 * *off* the skill and rule promotion that `adaptive` had been doing.
 */

import type { Autonomy, HatsConfig } from '../core/config.js';
import { Logger, nullLogger } from '../core/logger.js';
import { isRevision, listProposals, noteBlocked, promoteProposal, type Proposal } from '../registry/proposals.js';

const RUNGS: Array<Autonomy['level']> = ['supervised', 'adaptive', 'self-healing', 'self-extending'];

export function atLeast(level: Autonomy['level'], required: Autonomy['level']): boolean {
  return RUNGS.indexOf(level) >= RUNGS.indexOf(required);
}

export interface AutoPromotion {
  promoted: Array<{ proposal: Proposal; written?: string }>;
  waiting: Array<{ proposal: Proposal; needs: number }>;
  blocked: Proposal[];
  /** Why something was refused, in words the panel can show without re-deriving them. */
  notes: Array<{ id: string; detail: string }>;
  /**
   * Defect reports this machine's autonomy level says to repair without being asked.
   *
   * Returned rather than acted on, because a repair is a *run* and this function has no
   * model. The caller that owns run-starting decides — which also keeps the recursion
   * obvious: a repair run must not queue more repairs from inside itself.
   */
  repairs: Proposal[];
}

export async function runAutoPromotion(
  config: HatsConfig,
  logger: Logger = nullLogger,
): Promise<AutoPromotion> {
  const result: AutoPromotion = { promoted: [], waiting: [], blocked: [], notes: [], repairs: [] };
  const drafts = (await listProposals()).filter((p) => p.status === 'draft');
  const level = config.autonomy.level;

  for (const proposal of drafts) {
    if (proposal.kind === 'tool') {
      // A repair to a tool that already exists is not new capability (ADR-0010).
      if (proposal.patch) {
        if (atLeast(level, 'self-healing')) await attempt(proposal);
        else result.blocked.push(proposal);
        continue;
      }
      // A tool that carries a working handler installs itself at self-extending (ADR-0011).
      // The gates live in installGeneratedTool: name collision, and a load under its own
      // declared permissions. It never touches this repository, so the build and the test
      // suite have nothing to say about it and are not run.
      if (proposal.implementation) {
        // Asked for as conversation-scoped. It ran in the conversation that built it and is
        // kept only so a person can adopt it deliberately — installing it here would make
        // "nothing was installed on the device" false a few seconds after it was said.
        if (proposal.ephemeral) {
          result.blocked.push(proposal);
          await note(proposal, 'built for one conversation; promote it by hand if you want to keep it');
          continue;
        }
        if (!atLeast(level, 'self-extending')) {
          result.blocked.push(proposal);
          await note(proposal, 'a written tool installs at autonomy level self-extending; this machine is lower');
          continue;
        }
        if (proposal.occurrences < 1) {
          result.waiting.push({ proposal, needs: 1 });
          continue;
        }
        await attempt(proposal);
        continue;
      }
      // A defect report is not a contract, and telling someone to write a handler for a
      // tool that already exists is nonsense. At self-healing and above the agent repairs
      // it without being asked; below that it waits for a person to press the button.
      if (proposal.defect) {
        if (proposal.repairStartedAt) {
          result.blocked.push(proposal);
          await note(proposal, `a repair was already attempted on ${proposal.repairStartedAt.slice(0, 10)}`);
        } else if (atLeast(level, 'self-healing')) {
          result.repairs.push(proposal);
        } else {
          result.blocked.push(proposal);
          await note(proposal, `${proposal.defect.tool} keeps failing; press Repair, or raise autonomy to self-healing to have it attempted for you`);
        }
        continue;
      }

      // A contract with no handler still needs someone to write one.
      result.blocked.push(proposal);
      await note(proposal, 'describes a tool but carries no handler — build_tool writes one that can install');
      continue;
    }

    // Skills and rules: recomposition, and the original bargain. Evidence is the gate.
    if (!atLeast(level, 'adaptive')) {
      result.waiting.push({ proposal, needs: 0 });
      continue;
    }

    // A revision lands on first sighting; a new playbook still has to recur.
    //
    // The recurrence threshold asks "has this been needed enough times to be worth adding?"
    // — the right question for something new, and the wrong one for a fix to something that
    // already exists and is already wrong. Making a correct one-off correction wait for the
    // same problem to happen twice more means the agent watches a playbook misfire, knows
    // exactly how to fix it, and is told to come back after it has misfired again.
    //
    // The safety argument is different too. A new playbook is unbounded; a revision targets
    // one existing entry, keeps its id, is version-stamped with the old text retained, and
    // for rules cannot weaken strength or enforcement (see registry/revision.ts). The blast
    // radius is one file that was already there and is one `hats registry` away from being
    // reverted.
    if (await isRevision(proposal)) {
      await attempt(proposal);
      continue;
    }

    if (proposal.occurrences < config.autonomy.promoteAfterOccurrences) {
      result.waiting.push({
        proposal,
        needs: config.autonomy.promoteAfterOccurrences - proposal.occurrences,
      });
      continue;
    }
    await attempt(proposal);
  }

  /** Carried out for the caller and written onto the proposal, so the panel can show it. */
  async function note(proposal: Proposal, detail: string): Promise<void> {
    result.notes.push({ id: proposal.id, detail });
    await noteBlocked(proposal.id, detail);
  }

  async function attempt(proposal: (typeof drafts)[number]): Promise<void> {
    try {
      const outcome = await promoteProposal(proposal.id);
      result.promoted.push({ proposal, ...(outcome.written ? { written: outcome.written } : {}) });
      logger.warn('autonomy.promoted', {
        id: proposal.id,
        kind: proposal.kind,
        title: proposal.title,
        occurrences: proposal.occurrences,
        written: outcome.written,
      });
    } catch (e) {
      // A malformed proposal must not take the run down; it stays a draft for a human, and
      // the reason is carried out rather than only logged — a refusal nobody can see reads
      // as the feature silently not working.
      const detail = (e as Error).message;
      logger.warn('autonomy.promote.failed', { id: proposal.id, error: detail });
      result.waiting.push({ proposal, needs: 0 });
      await note(proposal, detail);
    }
  }
  return result;
}

/** One line the human sees when the system extended itself. Never silent. */
export function describePromotion(result: AutoPromotion): string {
  const lines: string[] = [];
  if (result.promoted.length > 0) {
    const names = result.promoted.map((p) => `${p.proposal.kind} “${p.proposal.title}”`).join(', ');
    lines.push(
      `self-extended: promoted ${names}. Review with \`hats registry\`; revert by editing or archiving the file.`,
    );
  }
  if (result.repairs.length > 0) {
    lines.push(
      `repairing ${result.repairs.map((p) => p.defect?.tool ?? p.title).join(', ')} without being asked — ` +
        `the patch applies only if the build and the whole test suite pass.`,
    );
  }
  return lines.join('\n');
}
