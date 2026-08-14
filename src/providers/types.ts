/**
 * The normalized model interface. ADR-0002: the engine never sees a wire format.
 */

import type { Tier, ToolProtocol } from '../core/config.js';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  /** Provider-supplied id, or one synthesised locally (Ollama omits them). */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string;
  /** Present on assistant messages that requested actions. */
  toolCalls?: ToolCall[];
  /** Present on tool messages: which call this observation answers. */
  toolCallId?: string;
  /** Tool name, carried for providers that need it on the result message. */
  name?: string;
}

/** JSON-Schema subset the runtime both emits to providers and validates against. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  model: string;
  system: string;
  /**
   * The same system prompt, split at the cache breakpoint. Providers that support explicit
   * prompt caching send the stable half as a cacheable block; the rest ignore this and use
   * `system`. See buildSystemParts for why the split exists.
   */
  systemParts?: { stable: string; volatile: string };
  messages: Message[];
  tools: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Forced protocol; otherwise the provider decides and may degrade (ADR-0002 §3). */
  toolProtocol?: ToolProtocol;
  signal?: AbortSignal;
}

/**
 * Normalised across providers, because they do not agree on what "input tokens" means.
 *
 * The invariant every adapter must hold: **inputTokens is the part billed at the full
 * input rate, and never includes cached tokens.** Anthropic already reports it that way;
 * OpenAI, DeepSeek and Gemini all fold the cached tokens into their prompt total, so those
 * adapters subtract. Without that, cost accounting double-counts the cached portion and
 * reports a saving as an expense.
 */
export interface Usage {
  /** Prompt tokens billed at the full input rate. Excludes anything served from cache. */
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens written into the prompt cache on this call (charged at a premium). */
  cacheWriteTokens?: number;
  /** Tokens served from the prompt cache (charged at roughly a tenth). */
  cacheReadTokens?: number;
}

export type StopReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'unknown';

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: StopReason;
  /** Which protocol actually produced the tool calls, after any degradation. */
  protocolUsed: 'native' | 'text';
  model: string;
  providerId: string;
  latencyMs: number;
}

export interface ModelInfo {
  id: string;
  /** Extra vendor detail worth showing in `hats models` (size, context, family). */
  detail?: string;
}

export interface ChatProvider {
  readonly id: string;
  readonly kind: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<ModelInfo[]>;
  embed?(texts: string[]): Promise<number[][]>;
}

export interface TierBinding {
  tier: Tier;
  providerId: string;
  model: string;
}
