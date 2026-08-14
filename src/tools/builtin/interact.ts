/**
 * Structured clarification and memory recall.
 *
 * Paper §2.2: "One loop action is easy to omit and costly to lack: structured
 * clarification." The pause is a first-class loop state — the tool returns the human's
 * answer as an ordinary observation and the loop continues with full history.
 */

import type { AskField, ClarificationRequest, ToolHandler, ToolResult } from '../types.js';

export const askUser: ToolHandler = {
  spec: {
    name: 'ask_user',
    description:
      'Pause and ask the human a question. Use options for a simple choice, or fields to collect several values at once — the panel renders them as a form in the conversation. Use it when two readings of the request would lead to materially different work, or when you need details only they have (a hostname, an account id, a key). Do not use it for facts you could establish with a tool call.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One specific question.' },
        options: {
          type: 'array',
          description: 'Two to four concrete choices, if the question is a choice.',
          items: { type: 'string' },
        },
        fields: {
          type: 'array',
          description:
            'Ask for several values at once as a form. Each field: name, label, type (text, number, select, secret, boolean), and options for a select. Use type "secret" for anything sensitive — its value is stored securely and you receive only a masked hint, never the value itself.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Key you will receive the answer under.' },
              label: { type: 'string', description: 'What to show above the input.' },
              type: {
                type: 'string',
                enum: ['text', 'number', 'select', 'secret', 'boolean'],
              },
              options: { type: 'array', items: { type: 'string' } },
              placeholder: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['name', 'label', 'type'],
          },
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
    const fields = normaliseFields(args['fields']);

    const request: ClarificationRequest = {
      question,
      ...(options.length > 0 ? { options } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    };
    const answer = await ctx.ask(request);
    return {
      summary: `The human answered: ${answer}`,
      payload: { question, options, fields: fields.map((f) => ({ ...f, value: undefined })), answer },
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

/**
 * Field definitions come from the model, so they are rebuilt here rather than trusted.
 * A malformed one is dropped instead of failing the call — the form is a convenience and
 * losing a field is better than losing the question.
 */
function normaliseFields(raw: unknown): AskField[] {
  if (!Array.isArray(raw)) return [];
  const out: AskField[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const name = String(f['name'] ?? '').trim();
    const label = String(f['label'] ?? '').trim();
    const type = String(f['type'] ?? 'text');
    if (!name || !label) continue;
    if (!['text', 'number', 'select', 'secret', 'boolean'].includes(type)) continue;
    out.push({
      name,
      label,
      type: type as AskField['type'],
      ...(Array.isArray(f['options']) ? { options: (f['options'] as unknown[]).map(String).slice(0, 12) } : {}),
      ...(f['placeholder'] ? { placeholder: String(f['placeholder']) } : {}),
      ...(f['required'] ? { required: true } : {}),
    });
  }
  return out;
}

export const interactTools: ToolHandler[] = [askUser, recallMemory];
