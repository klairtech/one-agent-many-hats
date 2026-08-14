/**
 * The text tool protocol (ADR-0002 §3).
 *
 * Why this exists: `gemma3:4b` is served by Ollama without tool support [VERIFIED on this
 * machine], and a runtime whose entire action surface is tool calls would be useless
 * against it. Here tools are described in the prompt and the model answers with a fenced
 * block, which the adapter parses into the same normalized ToolCall shape the native path
 * produces. The engine cannot tell the difference; the run record can, and says so.
 *
 * This is materially worse than native tool calling on small models. It is a degradation,
 * labelled as one, not a co-equal option.
 */

import type { JsonSchema, ToolCall, ToolSchema } from './types.js';

export const TOOL_FENCE = 'hats:tool';

export function renderToolsForPrompt(tools: ToolSchema[]): string {
  if (tools.length === 0) return '';
  const lines: string[] = [
    '## Available actions',
    '',
    'You cannot act directly. To act, emit exactly one fenced block per action:',
    '',
    '```' + TOOL_FENCE,
    '{"name": "<action name>", "args": { ... }}',
    '```',
    '',
    'Rules for action blocks:',
    '- The block must contain a single JSON object with keys "name" and "args".',
    '- Emit the block and stop. The result comes back to you before you continue.',
    '- If you can answer without acting, answer in plain prose and emit no block.',
    '',
    'Actions:',
  ];
  for (const t of tools) {
    lines.push('', `### ${t.name}`, t.description.trim(), `args: ${describeSchema(t.parameters)}`);
  }
  return lines.join('\n');
}

function describeSchema(schema: JsonSchema): string {
  if (!schema || schema.type !== 'object' || !schema.properties) return '{}';
  const required = new Set(schema.required ?? []);
  const parts = Object.entries(schema.properties).map(([key, sub]) => {
    const opt = required.has(key) ? '' : '?';
    const enumPart = sub.enum ? ` (${sub.enum.map((v) => JSON.stringify(v)).join('|')})` : '';
    const desc = sub.description ? ` — ${sub.description}` : '';
    return `${key}${opt}: ${sub.type ?? 'any'}${enumPart}${desc}`;
  });
  return `{ ${parts.join('; ')} }`;
}

export interface ParsedTextResponse {
  text: string;
  toolCalls: ToolCall[];
}

/**
 * Permissive on the way in, strict on the way out. Accepts the documented fence, a
 * ```json fence whose object has name+args, and a bare top-level JSON object of the same
 * shape — small models produce all three. Anything else is treated as prose.
 */
export function parseTextToolCalls(raw: string, idPrefix = 'txt'): ParsedTextResponse {
  const toolCalls: ToolCall[] = [];
  let text = raw;
  let index = 0;

  const fenceRe = /```(?:hats:tool|hats-tool|tool|json)?\s*\n([\s\S]*?)```/g;
  const consumed: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const call = coerceCall(m[1] ?? '', `${idPrefix}_${index}`);
    if (call) {
      toolCalls.push(call);
      consumed.push([m.index, m.index + m[0].length]);
      index++;
    }
  }

  if (toolCalls.length === 0) {
    const bare = firstBalancedObject(raw);
    if (bare) {
      const call = coerceCall(bare.json, `${idPrefix}_0`);
      if (call) {
        toolCalls.push(call);
        consumed.push([bare.start, bare.end]);
      }
    }
  }

  for (const [start, end] of consumed.reverse()) {
    text = text.slice(0, start) + text.slice(end);
  }
  return { text: text.trim(), toolCalls };
}

function coerceCall(body: string, id: string): ToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const name = obj['name'] ?? obj['tool'] ?? obj['action'] ?? obj['function'];
  if (typeof name !== 'string' || !name) return null;
  const rawArgs = obj['args'] ?? obj['arguments'] ?? obj['parameters'] ?? obj['input'] ?? {};
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try {
      const reparsed = JSON.parse(rawArgs) as unknown;
      if (reparsed && typeof reparsed === 'object') args = reparsed as Record<string, unknown>;
    } catch {
      /* leave empty; schema validation will produce the useful error */
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs as Record<string, unknown>;
  }
  return { id, name, args };
}

/** Scans for the first `{...}` that parses and carries a name-like key. */
function firstBalancedObject(raw: string): { json: string; start: number; end: number } | null {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < raw.length; j++) {
      const ch = raw[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const json = raw.slice(i, j + 1);
          if (/"(name|tool|action)"\s*:/.test(json)) return { json, start: i, end: j + 1 };
          break;
        }
      }
    }
  }
  return null;
}

/** Render a tool observation for a model that has no tool-result message role. */
export function renderToolResultAsText(name: string, content: string): string {
  return `Result of ${name}:\n${content}`;
}
