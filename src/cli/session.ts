/**
 * Shared start-up: resolve the workspace, load config, bootstrap the registry, build the
 * provider pool and open the memory layers. Every command that needs the runtime goes
 * through here so the resolution order is identical in all of them.
 */

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, type HatsConfig, type Profile } from '../core/config.js';
import { HatsError } from '../core/errors.js';
import { Logger } from '../core/logger.js';
import { hatsHome, workspaceDir, workspaceSlug } from '../core/paths.js';
import { ensureDir, exists, writeTextAtomic } from '../core/store.js';
import { MemoryLayers } from '../memory/index.js';
import { McpManager } from '../mcp/index.js';
import { ProviderPool } from '../providers/index.js';
import { knownEnforcementPoints } from '../engine/gates.js';
import { Registry } from '../registry/loader.js';
import { DocumentIndex } from '../rag/index.js';
import { ALL_TOOLS } from '../tools/index.js';
import type { DocumentAccess, ToolHandler } from '../tools/types.js';

export interface SessionFlags {
  workspace?: string;
  profile?: string;
  provider?: string;
  model?: string;
  network?: boolean;
}

export interface Session {
  config: HatsConfig;
  registry: Registry;
  pool: ProviderPool;
  memory: MemoryLayers;
  workspaceRoot: string;
  slug: string;
  profile: Profile;
  logger: Logger;
  /** Built-ins plus every tool from a connected MCP server. */
  handlers: ToolHandler[];
  mcp: McpManager;
  index: DocumentIndex;
  documents: DocumentAccess;
}

const PROFILES = new Set<Profile>(['read-only', 'assisted', 'trusted']);

export async function openSession(flags: SessionFlags = {}): Promise<Session> {
  // Resolve symlinks once, here. PathGuard realpaths everything it checks, so a root that
  // is still symlinked makes every `path.relative(root, resolved)` wrong — on macOS that
  // is every workspace under /tmp, and any symlinked home directory.
  // [Found by the file-browser test, 2026-08-14.]
  const requested = path.resolve(flags.workspace ?? process.cwd());
  const workspaceRoot = existsSync(requested) ? realpathSync(requested) : requested;
  const slug = workspaceSlug(workspaceRoot);
  const config = await loadConfig();

  if (flags.profile) {
    if (!PROFILES.has(flags.profile as Profile)) {
      throw new HatsError('CONFIG_INVALID', `unknown profile "${flags.profile}"`, {
        allowed: [...PROFILES],
      });
    }
    config.profile = flags.profile as Profile;
  }
  if (flags.network) config.network = { ...config.network, enabled: true };

  // `--provider x --model y` binds every tier for this invocation. Still a coded seam:
  // it comes from the command line, never from the model.
  if (flags.provider || flags.model) {
    const providerId = flags.provider ?? config.defaultProvider;
    const provider = config.providers[providerId];
    if (!provider) {
      throw new HatsError('CONFIG_INVALID', `provider "${providerId}" is not configured`, {
        known: Object.keys(config.providers),
      });
    }
    config.defaultProvider = providerId;
    if (flags.model) {
      config.tiers = {
        light: `${providerId}/${flags.model}`,
        standard: `${providerId}/${flags.model}`,
        frontier: `${providerId}/${flags.model}`,
      };
    }
  }

  await ensureDir(workspaceDir(slug));
  await ensureDir(path.join(workspaceDir(slug), 'memory'));
  await stampWorkspace(slug, workspaceRoot);

  const registry = await Registry.load({ knownGates: knownEnforcementPoints() });
  const pool = new ProviderPool(config);
  const logger = new Logger({ base: { workspace: slug }, minLevel: 'info' });
  const memory = new MemoryLayers(slug, config, pool, logger);

  // MCP servers are connected once per session, not per run: the handshake and tools/list
  // cost is real, and a server that is down should degrade the session once, loudly,
  // rather than on every turn.
  const mcp = McpManager.fromConfig(config, logger);
  if (mcp.serverNames.length > 0) await mcp.connectAll();

  // The index is loaded lazily on first search, so a session with no index costs nothing.
  const index = DocumentIndex.forWorkspace(slug, logger);
  const documents: DocumentAccess = {
    search: (query, limit) => index.search(query, limit, pool.embedder()),
  };

  return {
    config,
    registry,
    pool,
    memory,
    workspaceRoot,
    slug,
    profile: config.profile,
    logger,
    handlers: [...ALL_TOOLS, ...mcp.handlers],
    mcp,
    index,
    documents,
  };
}

/** So `~/.hats/workspaces/<slug>` is identifiable months later without guessing. */
async function stampWorkspace(slug: string, root: string): Promise<void> {
  const file = path.join(workspaceDir(slug), 'WORKSPACE');
  if (await exists(file)) return;
  await writeTextAtomic(file, `${root}\n`);
}

export function homePaths(): { home: string; config: string } {
  return { home: hatsHome(), config: path.join(hatsHome(), 'config.json') };
}
