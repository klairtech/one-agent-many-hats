/**
 * Autonomy: how much of self-extension happens without a human (ADR-0006).
 *
 * The line is drawn between *recomposition* and *capability*. A skill or a rule can only
 * ever rearrange tools that already exist and constraints already in force — promoting one
 * cannot let the agent do anything it could not already do. A tool is different in kind:
 * it is new capability, new code, a new way to touch the world. So skills and rules can
 * earn their way in under evidence; tools cannot, at any autonomy level.
 */

import type { HatsConfig } from '../core/config.js';
import { Logger, nullLogger } from '../core/logger.js';
import { listProposals, promoteProposal, type Proposal } from '../registry/proposals.js';

export interface AutoPromotion {
  promoted: Array<{ proposal: Proposal; written?: string }>;
  waiting: Array<{ proposal: Proposal; needs: number }>;
  blocked: Proposal[];
}

export async function runAutoPromotion(
  config: HatsConfig,
  logger: Logger = nullLogger,
): Promise<AutoPromotion> {
  const result: AutoPromotion = { promoted: [], waiting: [], blocked: [] };
  const drafts = (await listProposals()).filter((p) => p.status === 'draft');

  for (const proposal of drafts) {
    if (proposal.kind === 'tool') {
      // ADR-0010: a proposal carrying a patch is a repair to a tool that already exists,
      // not new capability, so `self-healing` may apply it. The four checks still run —
      // promoteProposal refuses anything touching a tool's declared powers or a protected
      // file, and reverts anything that breaks the build or a test. This is the one place
      // a run can take a minute longer, because applying a patch runs the whole suite.
      if (proposal.patch && config.autonomy.level === 'self-healing') {
        await attempt(proposal);
        continue;
      }
      // Otherwise never, at any level: a new tool needs a typed handler, gates and a human.
      result.blocked.push(proposal);
      continue;
    }
    if (config.autonomy.level !== 'adaptive') {
      result.waiting.push({ proposal, needs: 0 });
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
      // A malformed proposal must not take the run down; it stays a draft for a human.
      logger.warn('autonomy.promote.failed', {
        id: proposal.id,
        error: (e as Error).message,
      });
      result.waiting.push({ proposal, needs: 0 });
    }
  }
  return result;
}

/** One line the human sees when the system extended itself. Never silent. */
export function describePromotion(result: AutoPromotion): string {
  if (result.promoted.length === 0) return '';
  const names = result.promoted.map((p) => `${p.proposal.kind} “${p.proposal.title}”`).join(', ');
  return `self-extended: promoted ${names}. Review with \`hats registry\`; revert by editing or archiving the file.`;
}
