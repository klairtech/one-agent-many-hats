/**
 * Scripted offline provider. The test suite drives the whole engine through this, so
 * loop/gate/memory behaviour is testable without a network or a GPU.
 */

import { HatsError } from '../core/errors.js';
import type { ChatProvider, ChatRequest, ChatResponse, ModelInfo } from './types.js';

export type MockTurn =
  | { text: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }
  | ((req: ChatRequest, turn: number) => {
      text: string;
      toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
    });

export class MockProvider implements ChatProvider {
  readonly kind = 'mock';
  /** Every request the engine made — the assertion surface for engine tests. */
  readonly calls: ChatRequest[] = [];
  private turn = 0;

  constructor(
    readonly id: string,
    private readonly script: MockTurn[],
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req);
    const entry = this.script[this.turn];
    if (!entry) {
      throw new HatsError('PROVIDER_ERROR', `mock provider exhausted at turn ${this.turn}`, {
        scripted: this.script.length,
      });
    }
    this.turn++;
    const result = typeof entry === 'function' ? entry(req, this.turn - 1) : entry;
    return {
      text: result.text,
      toolCalls: (result.toolCalls ?? []).map((c, i) => ({
        id: `mock_${this.turn}_${i}`,
        name: c.name,
        args: c.args,
      })),
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: (result.toolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop',
      protocolUsed: 'native',
      model: req.model,
      providerId: this.id,
      latencyMs: 0,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'mock-model', detail: 'scripted' }];
  }

  /** Deterministic pseudo-embeddings: hashed bag of words, unit length. */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(64).fill(0) as number[];
      for (const word of t.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
        v[h % 64] = (v[h % 64] ?? 0) + 1;
      }
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}
