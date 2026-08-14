/**
 * The staging half of self-extension (paper §4).
 *
 * These are the only tools that write to the registry, and they can only write to
 * `registry/proposals/**`. There is no tool that writes a live skill, rule or tool —
 * not a restricted one, not an admin one. Promotion is `hats promote`, run by a human.
 */

import { HatsError } from '../../core/errors.js';
import { stageProposal } from '../../registry/proposals.js';
import type { ToolHandler, ToolResult } from '../types.js';

const RATIONALE = {
  type: 'string' as const,
  description:
    'Why this should exist, in terms of what happened: what recurred, what failed, how often. Evidence, not opinion.',
};

export const proposeSkill: ToolHandler = {
  spec: {
    name: 'propose_skill',
    description:
      'Stage a draft skill for human review, when a kind of work has recurred and no playbook covers it. This does not change your behaviour now or in the next run — a human reviews and promotes it.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the proposed skill.' },
        rationale: RATIONALE,
        content: {
          type: 'string',
          description:
            'The full skill document: --- frontmatter (id, kind, version, description, tools, stages, review) --- then the playbook prose.',
        },
      },
      required: ['title', 'rationale', 'content'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  run: (args, ctx) => stage('skill', args, ctx),
};

export const proposeRule: ToolHandler = {
  spec: {
    name: 'propose_rule',
    description:
      'Stage a draft guardrail for human review, when something went wrong that a constraint would have prevented. State the enforcement strength you think it deserves and why.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the proposed rule.' },
        rationale: RATIONALE,
        content: {
          type: 'string',
          description:
            'The full rule document: --- frontmatter (id, statement, strength, scope, enforced_by, on_violation, version) --- then the reasoning.',
        },
      },
      required: ['title', 'rationale', 'content'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  run: (args, ctx) => stage('rule', args, ctx),
};

export const proposeTool: ToolHandler = {
  spec: {
    name: 'propose_tool',
    description:
      'Stage a proposal for a new named tool, when the same irregular computation has been written in the sandbox more than once. Describe the contract: name, inputs as references, what it returns, what it must refuse.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Proposed tool name, snake_case.' },
        rationale: RATIONALE,
        content: {
          type: 'string',
          description:
            'The contract: description the model would read, input schema, output shape, determinism and refusal conditions.',
        },
      },
      required: ['title', 'rationale', 'content'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  run: (args, ctx) => stage('tool', args, ctx),
};

async function stage(
  kind: 'skill' | 'rule' | 'tool',
  args: Record<string, unknown>,
  ctx: Parameters<ToolHandler['run']>[1],
): Promise<ToolResult> {
  const title = String(args['title'] ?? '').trim();
  const content = String(args['content'] ?? '').trim();
  if (!title || !content) {
    throw new HatsError('TOOL_INPUT_INVALID', 'a proposal needs a title and content', {});
  }

  const proposal = await stageProposal({
    kind,
    title,
    rationale: String(args['rationale'] ?? ''),
    evidence: [`run:${ctx.runId}`],
    content,
    createdByRun: ctx.runId,
  });

  return {
    summary:
      `staged ${kind} proposal "${title}" as ${proposal.id}` +
      (proposal.occurrences > 1 ? ` (seen ${proposal.occurrences} times now)` : '') +
      `. It is a draft: it does not affect this run or the next one. A human promotes it with \`hats promote ${proposal.id}\`.`,
    payload: proposal,
    provenance: { kind, title },
  };
}

export const proposeTools: ToolHandler[] = [proposeSkill, proposeRule, proposeTool];
