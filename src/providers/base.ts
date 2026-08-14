/**
 * Shared provider behaviour: protocol selection and automatic degradation.
 *
 * Adapters implement `send()` for one wire format. Everything about *which* tool
 * protocol to use, and what to do when a model turns out not to support tools, lives
 * here so all four adapters degrade identically.
 */

import { isHatsError } from '../core/errors.js';
import type { ToolProtocol } from '../core/config.js';
import {
  parseTextToolCalls,
  renderToolResultAsText,
  renderToolsForPrompt,
  TOOL_FENCE,
} from './textProtocol.js';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  Message,
  ModelInfo,
  StopReason,
  ToolCall,
  Usage,
} from './types.js';

export interface RawResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: StopReason;
}

export abstract class BaseProvider implements ChatProvider {
  abstract readonly id: string;
  abstract readonly kind: string;

  /** Models observed to reject native tool calling; remembered for the process lifetime. */
  private readonly degraded = new Set<string>();

  protected constructor(protected readonly preferredProtocol: ToolProtocol = 'auto') {}

  protected abstract send(req: ChatRequest, useNativeTools: boolean): Promise<RawResult>;

  abstract listModels(): Promise<ModelInfo[]>;

  /** True once this model has failed a native tool call — surfaced in the run record. */
  isDegraded(model: string): boolean {
    return this.degraded.has(model);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const started = Date.now();
    const wanted: ToolProtocol = req.toolProtocol ?? this.preferredProtocol;
    const canTryNative =
      wanted !== 'text' && req.tools.length > 0 && !this.degraded.has(req.model);

    if (canTryNative) {
      try {
        const raw = await this.send(req, true);
        return this.finish(raw, 'native', req, started);
      } catch (e) {
        const noTools = isHatsError(e) && e.code === 'PROVIDER_NO_TOOL_SUPPORT';
        if (!noTools || wanted === 'native') throw e;
        this.degraded.add(req.model);
      }
    }

    const raw = await this.send(toTextProtocolRequest(req), false);
    const parsed = parseTextToolCalls(raw.text, `${this.id}_${Date.now().toString(36)}`);
    return this.finish(
      {
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage: raw.usage,
        stopReason: parsed.toolCalls.length > 0 ? 'tool_calls' : raw.stopReason,
      },
      'text',
      req,
      started,
    );
  }

  private finish(
    raw: RawResult,
    protocolUsed: 'native' | 'text',
    req: ChatRequest,
    started: number,
  ): ChatResponse {
    return {
      text: raw.text,
      toolCalls: raw.toolCalls,
      usage: raw.usage,
      stopReason: raw.stopReason,
      protocolUsed,
      model: req.model,
      providerId: this.id,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Rewrites a request for a model with no tool role at all: the tool catalogue moves into
 * the system prompt, prior tool calls become fenced blocks in assistant turns, and prior
 * observations become user turns. The conversation stays coherent across the switch, which
 * matters because degradation can happen mid-run.
 */
export function toTextProtocolRequest(req: ChatRequest): ChatRequest {
  const messages: Message[] = [];
  for (const m of req.messages) {
    if (m.role === 'tool') {
      messages.push({
        role: 'user',
        content: renderToolResultAsText(m.name ?? 'action', m.content),
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks = m.toolCalls
        .map((c) => '```' + TOOL_FENCE + '\n' + JSON.stringify({ name: c.name, args: c.args }) + '\n```')
        .join('\n');
      messages.push({ role: 'assistant', content: [m.content, blocks].filter(Boolean).join('\n') });
      continue;
    }
    messages.push({ role: m.role, content: m.content });
  }

  const toolBlock = renderToolsForPrompt(req.tools);
  return {
    ...req,
    system: toolBlock ? `${req.system}\n\n${toolBlock}` : req.system,
    messages,
    tools: [],
  };
}

/** Merge consecutive same-role messages — some providers reject alternating violations. */
export function coalesce(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && !prev.toolCalls && !m.toolCalls && m.role !== 'tool') {
      prev.content = `${prev.content}\n\n${m.content}`.trim();
    } else {
      out.push({ ...m });
    }
  }
  return out;
}
