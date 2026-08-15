/**
 * Joining agent-written tools to the platform registry (ADR-0011).
 *
 * Loaded at session assembly rather than imported statically, because these appear and
 * disappear while the runtime is installed and a static import list cannot describe a set
 * that the agent edits.
 */

import { Logger, nullLogger } from '../../core/logger.js';
import type { ToolHandler } from '../types.js';
import { generatedToolsDir } from '../../core/paths.js';
import { generatedHandler } from './handler.js';
import { listGeneratedTools } from './store.js';

export { generatedHandler, permissionFlags } from './handler.js';
export {
  assertUsableName,
  listGeneratedTools,
  readGeneratedCode,
  removeGeneratedTool,
  writeGeneratedTool,
  type GeneratedTool,
} from './store.js';

/**
 * Every installed tool the agent wrote, as handlers.
 *
 * A generated tool never shadows a built-in. The name check at build time already refuses
 * the collision, but this is the load-bearing one: a manifest can be edited by hand after
 * the fact, and `write_file` quietly resolving to agent-written code would be the worst
 * possible outcome of a feature about trust.
 */
export async function loadGeneratedTools(
  builtins: ToolHandler[],
  logger: Logger = nullLogger,
): Promise<ToolHandler[]> {
  const reserved = new Set(builtins.map((h) => h.spec.name));
  const handlers: ToolHandler[] = [];

  for (const { tool } of await listGeneratedTools(generatedToolsDir())) {
    if (reserved.has(tool.name)) {
      logger.warn('generated.shadowed', {
        name: tool.name,
        detail: 'a built-in already owns this name; the generated tool is ignored',
      });
      continue;
    }
    reserved.add(tool.name);
    handlers.push(generatedHandler(tool));
  }

  if (handlers.length > 0) {
    logger.info('generated.loaded', { tools: handlers.map((h) => h.spec.name) });
  }
  return handlers;
}
