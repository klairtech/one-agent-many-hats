/**
 * Ollama /api/chat.
 *
 * Close to the OpenAI shape but not identical, which is why it is its own adapter:
 * tool calls carry no ids (synthesised here), arguments arrive as an object rather than
 * a JSON string, token counts use different field names, and `stream:false` is required
 * or the body is NDJSON.
 *
 * [VERIFIED on this machine] `qwen2.5:7b` supports native tools; `gemma3:4b` does not and
 * returns a 400 whose message trips the degradation path in BaseProvider.
 */

import { HatsError } from '../core/errors.js';
import type { ProviderConfig } from '../core/config.js';
import { BaseProvider, coalesce, type RawResult } from './base.js';
import { requestJson } from './http.js';
import { trimSlash } from './openaiCompat.js';
import type { ChatRequest, Message, ModelInfo, StopReason, ToolCall } from './types.js';

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
  tool_name?: string;
}

interface OllamaChatResponse {
  message?: OllamaMessage;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export class OllamaProvider extends BaseProvider {
  readonly kind = 'ollama';

  constructor(
    readonly id: string,
    private readonly cfg: ProviderConfig,
  ) {
    super(cfg.toolProtocol ?? 'auto');
  }

  protected async send(req: ChatRequest, useNativeTools: boolean): Promise<RawResult> {
    const options: Record<string, unknown> = {};
    if (req.temperature !== undefined) options['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) options['num_predict'] = req.maxTokens;

    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOllamaMessages(req.system, req.messages),
      stream: false,
    };
    if (Object.keys(options).length > 0) body['options'] = options;
    if (useNativeTools && req.tools.length > 0) {
      body['tools'] = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await requestJson<OllamaChatResponse>(`${trimSlash(this.cfg.baseUrl)}/api/chat`, {
      headers: this.cfg.headers ?? {},
      body,
      providerId: this.id,
      timeoutMs: this.cfg.requestTimeoutMs ?? 300_000,
      signal: req.signal,
    });

    if (res.error) {
      throw new HatsError('PROVIDER_ERROR', `${this.id}: ${res.error}`, {});
    }

    const msg = res.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((c, i) => ({
      // Ollama does not return ids; the loop needs one to match observations to calls.
      id: `call_${i}_${Math.random().toString(36).slice(2, 8)}`,
      name: c.function?.name ?? 'unknown',
      args: (c.function?.arguments ?? {}) as Record<string, unknown>,
    }));

    return {
      text: msg?.content ?? '',
      toolCalls,
      usage: { inputTokens: res.prompt_eval_count, outputTokens: res.eval_count },
      stopReason: mapDone(res.done_reason, toolCalls.length > 0),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await requestJson<{
      models?: Array<{
        name?: string;
        size?: number;
        details?: { parameter_size?: string; quantization_level?: string };
      }>;
    }>(`${trimSlash(this.cfg.baseUrl)}/api/tags`, {
      method: 'GET',
      providerId: this.id,
      retries: 0,
      timeoutMs: 5_000,
    });
    return (res.models ?? [])
      .filter((m): m is { name: string } & typeof m => typeof m.name === 'string')
      .map((m) => ({
        id: m.name,
        detail: [m.details?.parameter_size, m.details?.quantization_level]
          .filter(Boolean)
          .join(' '),
      }));
  }

  async embed(texts: string[]): Promise<number[][]> {
    const model = this.cfg.embedModel;
    if (!model) throw new HatsError('CONFIG_MISSING', `${this.id}: no embedModel configured`, {});
    const res = await requestJson<{ embeddings?: number[][] }>(
      `${trimSlash(this.cfg.baseUrl)}/api/embed`,
      { body: { model, input: texts }, providerId: this.id },
    );
    return res.embeddings ?? [];
  }
}

export function toOllamaMessages(system: string, messages: Message[]): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (system.trim()) out.push({ role: 'system', content: system });
  for (const m of coalesce(messages)) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content, tool_name: m.name });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.toolCalls.map((c) => ({
          function: { name: c.name, arguments: c.args ?? {} },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function mapDone(reason: string | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_calls';
  if (reason === 'length') return 'length';
  return 'stop';
}
