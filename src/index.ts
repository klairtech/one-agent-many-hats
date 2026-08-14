/**
 * Library surface. The CLI is one consumer of this; a UI or a server would be another.
 */

export { runAgent, advanceStage } from './engine/run.js';
export type { RunOptions, RunResult, RunEvent } from './engine/run.js';
export * from './engine/compose.js';
export * from './engine/gates.js';
export { extractClaims, reconcile } from './engine/reconcile.js';

export { Registry, syncPacks, parseSkill, parseRule } from './registry/loader.js';
export * from './registry/types.js';
export * from './registry/proposals.js';
export { parseDocument, parseFrontmatter } from './registry/frontmatter.js';

export { Executor, ArtifactStore, ALL_TOOLS, toolRegistry, toSchemas } from './tools/index.js';
export type { ToolContext, ToolHandler, ToolObservation, ToolResult } from './tools/types.js';
export { validateInput } from './tools/validate.js';
export { validateOutput } from './tools/sandbox/sandbox.js';

export { MemoryLayers, LessonStore, TakeawayStore, PersonaStore, OrgContext, assertBehavioural } from './memory/index.js';
export * from './memory/types.js';

export { ProviderPool, createProvider, MockProvider } from './providers/index.js';
export type { ChatProvider, ChatRequest, ChatResponse, Message } from './providers/types.js';
export { parseTextToolCalls, renderToolsForPrompt } from './providers/textProtocol.js';

export * from './core/config.js';
export { HatsError, isHatsError } from './core/errors.js';
export { PathGuard, hatsHome, workspaceSlug, workspaceDir, packDir } from './core/paths.js';
export { Logger } from './core/logger.js';
export { assertToolNetworkAllowed } from './core/net.js';
export { PRESETS } from './core/presets.js';
