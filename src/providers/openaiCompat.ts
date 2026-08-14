/**
 * OpenAI /v1/chat/completions wire format.
 *
 * ADR-0002: this one adapter serves OpenAI, DeepSeek, Qwen/DashScope, Moonshot/Kimi,
 * Zhipu GLM, Groq, OpenRouter, Mistral, Together, xAI, LM Studio and vLLM. They differ
 * by base URL and key, not by code.
 */

import { HatsError } from '../core/errors.js';
import type { ProviderConfig } from '../core/config.js';
import { BaseProvider, coalesce, type RawResult } from './base.js';
import { looksLikeNoToolSupport, requestJson } from './http.js';
import type { ChatRequest, Message, ModelInfo, StopReason, ToolCall, Usage } from './types.js';

interface OaiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface OaiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
  name?: string;
}
interface OaiResponse {
  choices?: Array<{ message?: OaiMessage; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** OpenAI: the cached slice of prompt_tokens. */
    prompt_tokens_details?: { cached_tokens?: number };
    /** DeepSeek reports the same split under its own names. */
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  error?: { message?: string };
}

export class OpenAiCompatProvider extends BaseProvider {
  readonly kind = 'openai-compat';

  constructor(
    readonly id: string,
    private readonly cfg: ProviderConfig,
    private readonly apiKey: string | undefined,
  ) {
    super(cfg.toolProtocol ?? 'auto');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { ...(this.cfg.headers ?? {}) };
    if (this.apiKey) h['authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  protected async send(req: ChatRequest, useNativeTools: boolean): Promise<RawResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOaiMessages(req.system, req.messages),
      stream: false,
    };
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (useNativeTools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body['tool_choice'] = 'auto';
    }

    const res = await requestJson<OaiResponse>(`${trimSlash(this.cfg.baseUrl)}/chat/completions`, {
      headers: this.headers(),
      body,
      providerId: this.id,
      timeoutMs: this.cfg.requestTimeoutMs,
      signal: req.signal,
    });

    if (res.error?.message && looksLikeNoToolSupport(res.error.message)) {
      // Some gateways return 200 with an error envelope instead of a 400.
      throw new HatsError('PROVIDER_NO_TOOL_SUPPORT', `${this.id}: ${res.error.message}`, {});
    }

    const choice = res.choices?.[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.function?.name ?? 'unknown',
      args: parseArgs(c.function?.arguments),
    }));

    return {
      text: msg?.content ?? '',
      toolCalls,
      usage: splitOaiUsage(res.usage),
      stopReason: mapFinish(choice?.finish_reason, toolCalls.length > 0),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const path = this.cfg.modelsPath ?? '/models';
    const res = await requestJson<{ data?: Array<{ id?: string; owned_by?: string }> }>(
      `${trimSlash(this.cfg.baseUrl)}${path}`,
      { method: 'GET', headers: this.headers(), providerId: this.id, retries: 1 },
    );
    return (res.data ?? [])
      .filter((m): m is { id: string; owned_by?: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, detail: m.owned_by }));
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.cfg.embedModel) {
      throw new HatsError('CONFIG_MISSING', `${this.id}: no embedModel configured`, {});
    }
    const res = await requestJson<{ data?: Array<{ embedding?: number[] }> }>(
      `${trimSlash(this.cfg.baseUrl)}/embeddings`,
      {
        headers: this.headers(),
        body: { model: this.cfg.embedModel, input: texts },
        providerId: this.id,
      },
    );
    return (res.data ?? []).map((d) => d.embedding ?? []);
  }
}

export function toOaiMessages(system: string, messages: Message[]): OaiMessage[] {
  const out: OaiMessage[] = [];
  if (system.trim()) out.push({ role: 'system', content: system });
  for (const m of coalesce(messages)) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '', name: m.name });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

/**
 * OpenAI-style prompt caching is automatic — there is nothing to send, only something to
 * read back. `prompt_tokens` *includes* the cached slice, so it is subtracted here to keep
 * the Usage invariant: inputTokens is what you pay full rate for.
 *
 * OpenAI reports the split under `prompt_tokens_details.cached_tokens`; DeepSeek under
 * `prompt_cache_hit_tokens`. Vendors that report neither simply have no cached tokens to
 * show, which is reported as none rather than guessed at.
 */
export function splitOaiUsage(usage: OaiResponse['usage']): Usage {
  const prompt = usage?.prompt_tokens;
  const cached =
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? undefined;

  const out: Usage = {};
  if (usage?.completion_tokens !== undefined) out.outputTokens = usage.completion_tokens;
  if (prompt !== undefined) {
    out.inputTokens = cached !== undefined ? Math.max(0, prompt - cached) : prompt;
  } else if (usage?.prompt_cache_miss_tokens !== undefined) {
    out.inputTokens = usage.prompt_cache_miss_tokens;
  }
  if (cached !== undefined) out.cacheReadTokens = cached;
  // Nobody in this family bills a separate cache write; there is nothing to report.
  return out;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function mapFinish(reason: string | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_calls';
  switch (reason) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    default:
      return reason ? 'unknown' : 'stop';
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
