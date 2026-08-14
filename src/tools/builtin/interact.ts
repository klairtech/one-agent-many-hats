/**
 * Structured clarification and memory recall.
 *
 * Paper §2.2: "One loop action is easy to omit and costly to lack: structured
 * clarification." The pause is a first-class loop state — the tool returns the human's
 * answer as an ordinary observation and the loop continues with full history.
 */

import type { ToolHandler, ToolResult } from '../types.js';

export const askUser: ToolHandler = {
  spec: {
    name: 'ask_user',
    description:
      'Pause and ask the human a question, optionally with a short list of options. Use it when two readings of the request would lead to materially different work, or when scope is missing. Do not use it for facts you could establish with a tool call.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One specific question.' },
        options: {
          type: 'array',
          description: 'Two to four concrete choices, if the question is a choice.',
          items: { type: 'string' },
        },
      },
      required: ['question'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
    maxSummaryChars: 2_000,
  },
  async run(args, ctx): Promise<ToolResult> {
    const question = String(args['question']);
    const options = Array.isArray(args['options']) ? (args['options'] as string[]).map(String) : [];
    const request = options.length > 0 ? { question, options } : { question };
    const answer = await ctx.ask(request);
    return {
      summary: `The human answered: ${answer}`,
      payload: { question, options, answer },
      provenance: { question },
    };
  },
};

export const recallMemory: ToolHandler = {
  spec: {
    name: 'recall_memory',
    description:
      'Search what this workspace remembers from past runs: takeaways, corrections and stated preferences. Use it when the request refers to something established earlier, or before asking the human something they may already have told you.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are trying to remember.' },
        limit: { type: 'integer', description: 'How many entries. Default 5.', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    if (!ctx.memory) {
      return { summary: 'memory is not available in this run', payload: [], failed: true };
    }
    const query = String(args['query']);
    const limit = Number(args['limit'] ?? 5);
    const hits = await ctx.memory.recall(query, limit);
    if (hits.length === 0) {
      return {
        summary: `nothing remembered about "${query}". This may genuinely be new — say so rather than inventing continuity.`,
        payload: [],
      };
    }
    return {
      summary: hits
        .map((h, i) => `${i + 1}. [${h.source}, score ${h.score.toFixed(2)}] ${h.text}`)
        .join('\n'),
      payload: hits,
      provenance: { query },
    };
  },
};

export const interactTools: ToolHandler[] = [askUser, recallMemory];
