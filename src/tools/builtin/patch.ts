/**
 * `propose_patch` — the agent fixing a tool it has watched fail (ADR-0010).
 *
 * This stages; it does not apply. Applying runs the build and the whole test suite, and
 * reverts on any failure. The static checks run here too, so a patch that could never be
 * applied is refused while the model still has the context to write a better one — being
 * told "that changes a tool's declared powers" at staging time is far more useful than
 * discovering it a day later in a promotion queue.
 */

import { HatsError } from '../../core/errors.js';
import { stageProposal } from '../../registry/proposals.js';
import { describePatch, validatePatch, type Patch } from '../../registry/patches.js';
import type { ToolHandler, ToolResult } from '../types.js';

export const proposePatch: ToolHandler = {
  spec: {
    name: 'propose_patch',
    description:
      "Propose a fix to a tool that keeps failing, when you can see what is wrong with it. Stages a find/replace for review — it does not change anything now or in this run. Applying it runs the build and the full test suite and reverts if either fails. You cannot change what a tool is permitted to do, only how it does it.",
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description:
            'Repo-relative path, under src/tools/builtin, src/tools/sandbox or packs. Read it first — the find text must match exactly.',
        },
        find: {
          type: 'string',
          description:
            'The exact text to replace, copied from the file. Must appear exactly once. Include enough surrounding lines to be unique.',
        },
        replace: { type: 'string', description: 'What to put in its place.' },
        reason: {
          type: 'string',
          description:
            'What is broken, how you know, and why this fixes it. Reference the runs where it failed.',
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'Run ids or error messages that show the defect.',
        },
      },
      required: ['file', 'find', 'replace', 'reason'],
    },
    // Staging writes only into the proposals directory, like the other propose_* tools.
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const patch: Patch = {
      id: '',
      file: String(args['file'] ?? '').trim(),
      find: String(args['find'] ?? ''),
      replace: String(args['replace'] ?? ''),
      reason: String(args['reason'] ?? '').trim(),
      evidence: Array.isArray(args['evidence']) ? (args['evidence'] as string[]).map(String) : [],
      createdByRun: ctx.runId,
    };

    if (!patch.reason) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        'a patch needs a reason — someone has to be able to judge it without rerunning your work',
        {},
      );
    }
    if (patch.find === patch.replace) {
      throw new HatsError('TOOL_INPUT_INVALID', 'the find and replace text are identical', {});
    }

    // Refused here rather than at promotion, while the model can still act on the answer.
    const check = validatePatch(patch);
    if (!check.applied) {
      throw new HatsError(
        'TOOL_NOT_ALLOWED',
        `that patch cannot be staged: ${check.reason}`,
        { stage: check.stage, file: patch.file },
        'rule/registry-immutability',
      );
    }

    const proposal = await stageProposal({
      kind: 'tool',
      title: `patch ${patch.file}`,
      rationale: patch.reason,
      content: describePatch(patch),
      evidence: patch.evidence.slice(0, 12),
      createdByRun: ctx.runId,
      patch,
    });

    return {
      summary:
        `Staged a patch to ${patch.file} as ${proposal.id}. Nothing has changed yet. ` +
        `Applying it runs the build and the whole test suite, and reverts if either fails: ` +
        `hats promote ${proposal.id}`,
      payload: { proposalId: proposal.id, file: patch.file },
      provenance: { adr: 'ADR-0010' },
    };
  },
};

export const patchTools: ToolHandler[] = [proposePatch];
