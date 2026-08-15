/**
 * The platform tool registry: the complete set of actions that exist.
 *
 * Paper §2.6.3: "Keep the registry small. A small set of well-described, composable tools
 * outperforms a large set of near-duplicates; overlap produces inconsistent tool selection
 * across runs." Adding one here is a real decision — it widens the action surface for
 * every skill that lists it.
 */

import type { ToolSchema } from '../providers/types.js';
import { fileTools } from './builtin/files.js';
import { computeTools } from './builtin/compute.js';
import { documentTools } from './builtin/documents.js';
import { interactTools } from './builtin/interact.js';
import { proposeTools } from './builtin/propose.js';
import { scheduleTask } from './builtin/schedule.js';
import { remoteTools } from './builtin/remote.js';
import { emailTools } from './builtin/email.js';
import { audioTools } from './builtin/audio.js';
import { browserTools } from './builtin/browser.js';
import { patchTools } from './builtin/patch.js';
import { buildTool } from './builtin/build.js';
import { searchTools } from './builtin/search.js';
import { systemTools } from './builtin/system.js';
import { sandboxTools } from './sandbox/sandbox.js';
import type { ToolHandler } from './types.js';

export const ALL_TOOLS: ToolHandler[] = [
  ...fileTools,
  ...documentTools,
  ...computeTools,
  ...sandboxTools,
  ...interactTools,
  ...proposeTools,
  scheduleTask,
  ...remoteTools,
  ...emailTools,
  ...audioTools,
  ...browserTools,
  ...patchTools,
  buildTool,
  ...searchTools,
  ...systemTools,
];

export function toolRegistry(handlers: ToolHandler[] = ALL_TOOLS): Map<string, ToolHandler> {
  const map = new Map<string, ToolHandler>();
  for (const h of handlers) map.set(h.spec.name, h);
  return map;
}

export function toolNames(handlers: ToolHandler[] = ALL_TOOLS): string[] {
  return handlers.map((h) => h.spec.name).sort();
}

/** What the provider is shown. Descriptions are prompt engineering; schemas are contract. */
export function toSchemas(handlers: ToolHandler[]): ToolSchema[] {
  return handlers.map((h) => ({
    name: h.spec.name,
    description: h.spec.description,
    parameters: h.spec.parameters,
  }));
}

export { Executor } from './executor.js';
export type { GateCheck, ExecuteOptions } from './executor.js';
export { ArtifactStore } from './artifacts.js';
export type { Artifact } from './artifacts.js';
export type { ToolContext, ToolHandler, ToolObservation, ToolResult } from './types.js';
