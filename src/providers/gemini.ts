/**
 * Google Gemini :generateContent.
 *
 * Three shape differences: the assistant role is called `model`, the system prompt is a
 * separate `systemInstruction`, and function results are `user` turns carrying
 * `functionResponse` parts. Gemini's schema dialect is also narrower than JSON Schema —
 * uppercase type names, and it rejects several keywords — so schemas are converted rather
 * than passed through.
 */

import type { ProviderConfig } from '../core/config.js';
import { BaseProvider, type RawResult } from './base.js';
import { requestJson } from './http.js';
import { trimSlash } from './openaiCompat.js';
import type {
  ChatRequest,
  JsonSchema,
  Message,
  ModelInfo,
  StopReason,
  ToolCall,
} from './types.js';

interface Part {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /** Gemini's implicit cache hit, folded inside promptTokenCount. */
    cachedContentTokenCount?: number;
  };
}

export class GeminiProvider extends BaseProvider {
  readonly kind = 'gemini';

  constructor(
    readonly id: string,
    private readonly cfg: ProviderConfig,
    private readonly apiKey: string | undefined,
  ) {
    super(cfg.toolProtocol ?? 'auto');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { ...(this.cfg.headers ?? {}) };
    if (this.apiKey) h['x-goog-api-key'] = this.apiKey;
    return h;
  }

  protected async send(req: ChatRequest, useNativeTools: boolean): Promise<RawResult> {
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) generationConfig['maxOutputTokens'] = req.maxTokens;

    const body: Record<string, unknown> = { contents: toGeminiContents(req.messages) };
    if (req.system.trim()) body['systemInstruction'] = { parts: [{ text: req.system }] };
    if (Object.keys(generationConfig).length > 0) body['generationConfig'] = generationConfig;
    if (useNativeTools && req.tools.length > 0) {
      body['tools'] = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: toGeminiSchema(t.parameters),
          })),
        },
      ];
    }

    const url = `${trimSlash(this.cfg.baseUrl)}/models/${encodeURIComponent(req.model)}:generateContent`;
    const res = await requestJson<GeminiResponse>(url, {
      headers: this.headers(),
      body,
      providerId: this.id,
      timeoutMs: this.cfg.requestTimeoutMs,
      signal: req.signal,
    });

    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall?.name)
      .map((p, i) => ({
        id: `call_${i}`,
        name: p.functionCall?.name ?? 'unknown',
        args: p.functionCall?.args ?? {},
      }));

    return {
      text,
      toolCalls,
      // Gemini caches implicitly on a stable prefix and folds the hit into
      // promptTokenCount, so subtract it to keep inputTokens meaning "billed at full rate".
      usage: {
        inputTokens: Math.max(
          0,
          (res.usageMetadata?.promptTokenCount ?? 0) -
            (res.usageMetadata?.cachedContentTokenCount ?? 0),
        ),
        outputTokens: res.usageMetadata?.candidatesTokenCount,
        ...(res.usageMetadata?.cachedContentTokenCount !== undefined
          ? { cacheReadTokens: res.usageMetadata.cachedContentTokenCount }
          : {}),
      },
      stopReason: mapFinishReason(res.candidates?.[0]?.finishReason, toolCalls.length > 0),
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await requestJson<{
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    }>(`${trimSlash(this.cfg.baseUrl)}${this.cfg.modelsPath ?? '/models'}`, {
      method: 'GET',
      headers: this.headers(),
      providerId: this.id,
      retries: 1,
    });
    return (res.models ?? [])
      .filter((m) => typeof m.name === 'string')
      .map((m) => ({
        // API returns "models/gemini-x"; the request path wants the bare id.
        id: (m.name as string).replace(/^models\//, ''),
        detail: m.displayName,
      }));
  }

  async embed(texts: string[]): Promise<number[][]> {
    const model = this.cfg.embedModel ?? 'text-embedding-004';
    const out: number[][] = [];
    for (const text of texts) {
      const res = await requestJson<{ embedding?: { values?: number[] } }>(
        `${trimSlash(this.cfg.baseUrl)}/models/${encodeURIComponent(model)}:embedContent`,
        {
          headers: this.headers(),
          body: { model: `models/${model}`, content: { parts: [{ text }] } },
          providerId: this.id,
        },
      );
      out.push(res.embedding?.values ?? []);
    }
    return out;
  }
}

export function toGeminiContents(messages: Message[]): Array<{ role: string; parts: Part[] }> {
  const out: Array<{ role: string; parts: Part[] }> = [];
  const push = (role: string, parts: Part[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      push('user', [
        {
          functionResponse: {
            name: m.name ?? 'tool',
            // Gemini requires an object; observations are strings by the time they get here.
            response: { result: m.content },
          },
        },
      ]);
      continue;
    }
    if (m.role === 'assistant') {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: c.name, args: c.args ?? {} } });
      }
      if (parts.length === 0) parts.push({ text: '' });
      push('model', parts);
      continue;
    }
    push('user', [{ text: m.content }]);
  }
  return out;
}

/** Gemini's Schema dialect: uppercase types, and no additionalProperties/default. */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) out['type'] = schema.type === 'integer' ? 'INTEGER' : schema.type.toUpperCase();
  if (schema.description) out['description'] = schema.description;
  if (schema.enum) out['enum'] = schema.enum.map(String);
  if (schema.items) out['items'] = toGeminiSchema(schema.items);
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties)) props[k] = toGeminiSchema(v);
    out['properties'] = props;
  }
  if (schema.required?.length) out['required'] = schema.required;
  return out;
}

function mapFinishReason(reason: string | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_calls';
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason === 'STOP') return 'stop';
  return reason ? 'unknown' : 'stop';
}
