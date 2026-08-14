/**
 * The tool contract. Paper §2.5: tools are the agent's entire action surface, and every
 * invocation passes through a single executor.
 */

import type { HatsConfig, Profile } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import type { PathGuard } from '../core/paths.js';
import type { ToolSpec } from '../registry/types.js';
import type { ArtifactStore } from './artifacts.js';

/** What a handler returns. The executor turns this into an artifact + a bounded summary. */
export interface ToolResult {
  /** What the model sees. The executor bounds it further if it exceeds the limit. */
  summary: string;
  /** What the record keeps. Stored whole. */
  payload?: unknown;
  provenance?: Record<string, unknown>;
  /** Set when the handler stored its own artifact (sandbox, derive). */
  artifactId?: string;
  /** Handler-level failure that the model should reason about rather than crash on. */
  failed?: boolean;
}

export interface ApprovalRequest {
  tool: string;
  /** One line the human reads before deciding. */
  headline: string;
  /** Full detail: a diff, a command line, a path list. */
  detail: string;
  /**
   * The validated arguments. Carried so a standing grant can be scoped to *this call* —
   * which path, which host, which recipient — rather than only to the tool's name.
   * (ADR-0009.)
   */
  args?: Record<string, unknown>;
  /**
   * Facts about the call that its arguments do not carry, contributed by the handler.
   *
   * `browser_act` is the case that forced this: clicking is a mutation on whatever page is
   * open, and the page is state inside the tool — nothing in `{action, target}` says which
   * site. Without it the tool could never be granted, so an unattended run could never
   * click anything. Produced by our own code, never by the model, and merged *under* the
   * arguments so a handler cannot overwrite what was actually asked for.
   */
  scope?: Record<string, unknown>;
}

export interface ClarificationRequest {
  question: string;
  options?: string[];
}

/** Retrieval surface the tools may use. Implemented by src/memory. */
export interface MemoryAccess {
  recall(query: string, limit: number): Promise<Array<{ text: string; source: string; score: number }>>;
}

/** Document retrieval over the indexed workspace. Implemented by src/rag. */
export interface DocumentAccess {
  search(query: string, limit: number): Promise<import('../rag/index.js').SearchResult>;
}

export interface ToolContext {
  runId: string;
  workspaceSlug: string;
  workspaceRoot: string;
  profile: Profile;
  stage: string;
  config: HatsConfig;
  guard: PathGuard;
  artifacts: ArtifactStore;
  logger: Logger;
  memory?: MemoryAccess;
  documents?: DocumentAccess;
  signal?: AbortSignal;
  /** Structured clarification (paper §2.2). Throws CLARIFICATION_REQUIRED when headless. */
  ask(request: ClarificationRequest): Promise<string>;
  /** Human approval for mutating calls (ADR-0005). */
  approve(request: ApprovalRequest): Promise<boolean>;
  /** ADR-0007: no human is present, so a denial is final and cannot be discussed. */
  unattended?: boolean;
  /** Task descriptors from sandbox runs, mined later into tool proposals (paper §4). */
  recordTaskDescriptor(descriptor: string): void;
}

export interface ToolHandler {
  spec: ToolSpec;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  /** Optional facts for grant scoping — see ApprovalRequest.scope. */
  scopeFacts?(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>>;
}

/** What the loop gets back. Never throws for expected denials — the model must see them. */
export interface ToolObservation {
  callId: string;
  tool: string;
  ok: boolean;
  summary: string;
  artifactId?: string;
  errorCode?: string;
  ruleId?: string;
  durationMs: number;
}

export type { ToolSpec };
