/**
 * Anthropic /v1/messages.
 *
 * Two shape differences that matter: content is an array of typed blocks rather than a
 * string, and tool results are *user* messages carrying `tool_result` blocks. Consecutive
 * observations must therefore be merged into one user turn, or the API rejects the
 * sequence. `max_tokens` is required, not optional.
 */

import type { ProviderConfig } from '../core/config.js';
import { BaseProvider, type RawResult } from './base.js';
import { requestJson } from './http.js';
import { trimSlash } from './openaiCompat.js';
import type { ChatRequest, Message, ModelInfo, StopReason, ToolCall } from './types.js';

const API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicResponse {
  content?: Block[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Models that answered a request by refusing `temperature`. Per-process, not persisted. */
const NO_TEMPERATURE = new Set<string>();

export function rejectsTemperature(e: unknown): boolean {
  const message = e instanceof Error ? e.message.toLowerCase() : '';
  return message.includes('temperature') && /deprecat|not support|unsupported|unexpected/.test(message);
}

export class AnthropicProvider extends BaseProvider {
  readonly kind = 'anthropic';

  constructor(
    readonly id: string,
    private readonly cfg: ProviderConfig,
    private readonly apiKey: string | undefined,
  ) {
    super(cfg.toolProtocol ?? 'auto');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'anthropic-version': API_VERSION,
      ...(this.cfg.headers ?? {}),
    };
    if (this.apiKey) h['x-api-key'] = this.apiKey;
    return h;
  }

  protected async send(req: ChatRequest, useNativeTools: boolean): Promise<RawResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      // Deliberately NOT caching the conversation — see toAnthropicMessages.
      messages: toAnthropicMessages(req.messages),
    };
    // Two cache breakpoints, in the order Anthropic hashes the prefix: tools, then
    // system. The stable half of the system prompt is identical across every step of a
    // run, so after the first call the skills, rules and memory are read from cache
    // instead of re-sent. The volatile half (stage, step budget, current hat) sits after
    // the breakpoint where changing it costs a few tokens rather than the whole prefix.
    if (req.systemParts && req.systemParts.stable.trim()) {
      const blocks: Array<Record<string, unknown>> = [
        { type: 'text', text: req.systemParts.stable, cache_control: { type: 'ephemeral' } },
      ];
      if (req.systemParts.volatile.trim()) {
        blocks.push({ type: 'text', text: req.systemParts.volatile });
      }
      body['system'] = blocks;
    } else if (req.system.trim()) {
      body['system'] = req.system;
    }
    // Newer models reject `temperature` outright ("deprecated for this model") rather than
    // ignoring it, which takes the whole request down with a 400. Once a model has said so
    // it is remembered, so the cost is one wasted call per model per process rather than a
    // hardcoded list that goes stale every release.
    // [Seen binding frontier to claude-sonnet-5, 2026-08-14.]
    if (req.temperature !== undefined && !NO_TEMPERATURE.has(req.model)) {
      body['temperature'] = req.temperature;
    }
    if (useNativeTools && req.tools.length > 0) {
      const tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })) as Array<Record<string, unknown>>;
      const last = tools[tools.length - 1];
      if (last) last['cache_control'] = { type: 'ephemeral' };
      body['tools'] = tools;
    }

    let res: AnthropicResponse;
    try {
      res = await requestJson<AnthropicResponse>(`${trimSlash(this.cfg.baseUrl)}/messages`, {
        headers: this.headers(),
        body,
        providerId: this.id,
        timeoutMs: this.cfg.requestTimeoutMs,
        signal: req.signal,
      });
    } catch (e) {
      if (!rejectsTemperature(e) || body['temperature'] === undefined) throw e;
      NO_TEMPERATURE.add(req.model);
      delete body['temperature'];
      res = await requestJson<AnthropicResponse>(`${trimSlash(this.cfg.baseUrl)}/messages`, {
        headers: this.headers(),
        body,
        providerId: this.id,
        timeoutMs: this.cfg.requestTimeoutMs,
        signal: req.signal,
      });
    }

    const text = (res.content ?? [])
      .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls: ToolCall[] = (res.content ?? [])
      .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: res.usage?.input_tokens,
        outputTokens: res.usage?.output_tokens,
        cacheWriteTokens: res.usage?.cache_creation_input_tokens,
        cacheReadTokens: res.usage?.cache_read_input_tokens,
      },
      stopReason: mapStop(res.stop_reason, toolCalls.length > 0),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await requestJson<{ data?: Array<{ id?: string; display_name?: string }> }>(
      `${trimSlash(this.cfg.baseUrl)}${this.cfg.modelsPath ?? '/models'}`,
      { method: 'GET', headers: this.headers(), providerId: this.id, retries: 1 },
    );
    return (res.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, detail: m.display_name }));
  }
}

/**
 * @param cacheConversation put a breakpoint on the final turn. **Off by default, because
 * measurement said it costs money rather than saving it.**
 *
 * [MEASURED on a 14-step Sonnet run, 2026-08-14] With this on: 53,138 tokens read from
 * cache and 234,684 written. Reads worked out at 3,796 per step — exactly the size of the
 * system-plus-tools prefix — while the writes were the growing transcript, stored every
 * step and never read back. At 1.25x for a write and 0.1x for a read that made the run
 * 3.8% *more* expensive than no caching at all.
 *
 * The likely mechanism is that this adapter merges consecutive tool results into a single
 * user turn, so an existing turn gains blocks as the run proceeds and the byte sequence a
 * cached prefix was keyed on stops matching. Caching the system prompt and tools — which
 * genuinely are byte-identical across steps — is where the saving actually is.
 *
 * Left in place, off, because the fix is a real one worth attempting: give each tool result
 * its own turn so earlier turns are immutable, then re-measure before turning this back on.
 */
export function toAnthropicMessages(
  messages: Message[],
  cacheConversation = false,
): Array<{ role: string; content: Block[] }> {
  const out: Array<{ role: string; content: Block[] }> = [];

  const pushUserBlocks = (blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user') last.content.push(...blocks);
    else out.push({ role: 'user', content: blocks });
  };

  for (const m of messages) {
    if (m.role === 'system') {
      // System text is hoisted into the top-level `system` field by send().
      pushUserBlocks([{ type: 'text', text: m.content }]);
      continue;
    }
    if (m.role === 'tool') {
      pushUserBlocks([
        { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content },
      ]);
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') last.content.push(...blocks);
      else out.push({ role: 'assistant', content: blocks });
      continue;
    }
    pushUserBlocks([{ type: 'text', text: m.content }]);
  }

  if (cacheConversation) {
    const lastTurn = out[out.length - 1];
    const lastBlock = lastTurn?.content[lastTurn.content.length - 1];
    if (lastBlock) (lastBlock as Record<string, unknown>)['cache_control'] = { type: 'ephemeral' };
  }
  return out;
}

function mapStop(reason: string | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls || reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  return 'unknown';
}
