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
      'Stage a draft skill, either new or a revision of one that exists. Use it when a kind of work has recurred and no playbook covers it, or when a playbook you just worked under was wrong or incomplete in a way you can now state precisely — pass `revises` for that case. It does not change your behaviour in this run.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the proposed skill.' },
        rationale: RATIONALE,
        revises: {
          type: 'string',
          description:
            'The id of an existing playbook this replaces, e.g. "outcome/answer". Read it with read_playbook first and edit that text — a revision keeps the id and bumps the version, and the previous version is kept so a bad one can be reverted. Prefer revising over adding whenever an existing playbook is nearly right: two playbooks that overlap make selection come out differently run to run.',
        },

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
      'Stage a draft guardrail, either new or a revision of one that exists. Use it when something went wrong that a constraint would have prevented, or when an existing rule fired on the wrong thing and you can say exactly how to narrow it — pass `revises` for that. You may sharpen what a rule says; you may not lower its strength or repoint its enforcement, and an attempt to is refused.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the proposed rule.' },
        rationale: RATIONALE,
        revises: {
          type: 'string',
          description:
            'The id of an existing playbook this replaces, e.g. "outcome/answer". Read it with read_playbook first and edit that text — a revision keeps the id and bumps the version, and the previous version is kept so a bad one can be reverted. Prefer revising over adding whenever an existing playbook is nearly right: two playbooks that overlap make selection come out differently run to run.',
        },

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

  const revises = typeof args['revises'] === 'string' ? args['revises'].trim() : '';
  if (revises && !new RegExp(`^id:\\s*${revises.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(content)) {
    // Caught here rather than at promotion: `revises: outcome/answer` with `id: outcome/answer-v2`
    // in the body is not a revision, it is a near-duplicate wearing a revision's label, and
    // the id in the document is what actually decides which file gets overwritten.
    throw new HatsError(
      'TOOL_INPUT_INVALID',
      `this claims to revise "${revises}" but the document's frontmatter does not say ` +
        `\`id: ${revises}\`. The id in the document is what decides which playbook is replaced, ` +
        `so they have to agree. Read the current one with read_playbook and edit that text.`,
      { revises },
    );
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
      `staged ${kind} ${revises ? `revision of ${revises}` : 'proposal'} "${title}" as ${proposal.id}` +
      (proposal.occurrences > 1 ? ` (seen ${proposal.occurrences} times now)` : '') +
      `. It is a draft: it does not affect this run or the next one. A human promotes it with \`hats promote ${proposal.id}\`.`,
    payload: proposal,
    provenance: { kind, title },
  };
}

export const proposeTools: ToolHandler[] = [proposeSkill, proposeRule, proposeTool];
