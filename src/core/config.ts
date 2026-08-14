/**
 * The one place that reads config and the one place that reads provider credentials
 * from the environment (REPO_RULES §5).
 */

import path from 'node:path';

import { HatsError } from './errors.js';
import { configPath, hatsHome } from './paths.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { ChannelConfig } from '../channels/types.js';
import { getCredential, type KeySource } from './credentials.js';
import { PRESETS, type ProviderKind } from './presets.js';
import { exists, readJson, writeJsonAtomic } from './store.js';

/** ADR-0005: the profile decides the worst case, and only a human can set it. */
export type Profile = 'read-only' | 'assisted' | 'trusted';

/** Paper §2.2 semantic model routing: a step is bound to a tier, never to a model id. */
export type Tier = 'light' | 'standard' | 'frontier';

export type ToolProtocol = 'native' | 'text' | 'auto';

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  /** Env var holding the key. Preferred: keys never land in config.json. */
  apiKeyEnv?: string;
  /** Literal key. Discouraged; if set, the file is chmod 600 on write. */
  apiKey?: string;
  modelsPath?: string;
  /** Model ids per tier. Filled by `hats init` from the live model list. */
  models?: Partial<Record<Tier, string>>;
  toolProtocol?: ToolProtocol;
  headers?: Record<string, string>;
  embedModel?: string;
  /** Model id for /audio/transcriptions. Defaults to whisper-1. */
  transcribeModel?: string;
  requestTimeoutMs?: number;
}

/** A remote host `ssh_run` may reach. The agent cannot add one. */
export interface RemoteHost {
  hostname: string;
  user?: string;
  port?: number;
  identityFile?: string;
  /** Extra `-o` options, passed through verbatim. */
  options?: string[];
  connectTimeoutMs?: number;
}

export interface HatsConfig {
  version: 1;
  /** Provider key used when a tier has no explicit `provider/model` binding. */
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
  /** `provider/model`, or omitted to use the provider's own `models[tier]`. */
  tiers: Partial<Record<Tier, string>>;
  profile: Profile;
  network: { enabled: boolean; allowHosts: string[] };
  sandbox: {
    runner: 'process' | 'docker';
    timeoutMs: number;
    memoryMb: number;
    maxOutputBytes: number;
  };
  limits: {
    stepBudget: number;
    maxToolOutputChars: number;
    contextCharBudget: number;
    maxToolCallsPerStep: number;
  };
  memory: {
    personaMaxChars: number;
    takeawayTopK: number;
    lessonTopK: number;
    embeddings: boolean;
    distill: boolean;
  };
  /** Paper §5.1: new workspaces run tighter until memory accumulates. */
  coldStart: { conservativeRuns: number };
  /** Document retrieval over the workspace. Keyword-only until an embedModel is set. */
  rag: { chunkChars: number; overlapChars: number; topK: number; autoIndex: boolean };
  /**
   * MCP servers, in the same shape Claude Desktop and Claude Code use, so an existing
   * config can be pasted in. Their tools appear as `mcp__<server>__<tool>`.
   */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Inbound message channels. Absent by default: this is the only surface where an
   * instruction arrives from off the machine, so it is opt-in and each one carries its own
   * sender allowlist. ADR-0007 governs what a message may do.
   */
  channels?: Record<string, ChannelConfig>;
  /**
   * Hosts `ssh_run` may reach, by alias. Absent means the tool has nowhere to go, which is
   * the default — the agent can never name a host that is not here.
   */
  remote?: { hosts: Record<string, RemoteHost> };
  /**
   * Outbound mail. `allowRecipients` has no wildcard: choosing who to contact on your
   * behalf is a decision for you, not the model.
   */
  email?: {
    host: string;
    port?: number;
    user?: string;
    from: string;
    fromName?: string;
    allowRecipients: string[];
  };
  /** ADR-0006: how much of self-extension promotes without a human. */
  autonomy: Autonomy;
}

/**
 * ADR-0006. `supervised` is the default and the paper's position. `adaptive` lets skills
 * and rules — which only ever recompose tools that already exist — promote themselves
 * under evidence. No level ever auto-promotes a tool, because a tool is new capability
 * rather than a new way of using capability you already granted.
 */
/**
 * ADR-0010 adds `self-healing`: a patch that passes the build and the entire test suite
 * applies without a prompt. It still cannot touch a tool's declared powers or any file
 * that enforces a boundary, so the level widens *what may be repaired*, never *what may
 * be permitted*.
 */
export interface Autonomy {
  level: 'supervised' | 'adaptive' | 'self-healing';
  /** How many times a proposal must recur before `adaptive` will promote it. */
  promoteAfterOccurrences: number;
  /** Auto-promoted entries land here first and are announced; never silently live. */
  announce: boolean;
}

export const DEFAULT_CONFIG: HatsConfig = {
  version: 1,
  defaultProvider: 'ollama',
  providers: {
    ollama: {
      kind: 'ollama',
      baseUrl: PRESETS['ollama']!.baseUrl,
      modelsPath: PRESETS['ollama']!.modelsPath!,
      toolProtocol: 'auto',
    },
  },
  tiers: {},
  profile: 'read-only',
  network: { enabled: false, allowHosts: [] },
  sandbox: { runner: 'process', timeoutMs: 5_000, memoryMb: 256, maxOutputBytes: 256_000 },
  limits: {
    stepBudget: 20,
    maxToolOutputChars: 4_000,
    contextCharBudget: 120_000,
    maxToolCallsPerStep: 4,
  },
  memory: {
    personaMaxChars: 1_200,
    takeawayTopK: 4,
    lessonTopK: 5,
    embeddings: false,
    distill: true,
  },
  coldStart: { conservativeRuns: 3 },
  rag: { chunkChars: 1_400, overlapChars: 160, topK: 6, autoIndex: false },
  mcpServers: {},
  autonomy: { level: 'supervised', promoteAfterOccurrences: 3, announce: true },
};

export async function loadConfig(file = configPath()): Promise<HatsConfig> {
  const raw = await readJson<Partial<HatsConfig> | null>(file, null);
  if (!raw) return structuredClone(DEFAULT_CONFIG);
  return validateConfig(mergeConfig(DEFAULT_CONFIG, raw));
}

export async function saveConfig(cfg: HatsConfig, file = configPath()): Promise<void> {
  await writeJsonAtomic(file, validateConfig(cfg));
}

export async function configExists(file = configPath()): Promise<boolean> {
  return exists(file);
}

/** Shallow-per-section merge: user config overrides defaults section by section. */
function mergeConfig(base: HatsConfig, over: Partial<HatsConfig>): HatsConfig {
  return {
    version: 1,
    defaultProvider: over.defaultProvider ?? base.defaultProvider,
    providers: { ...base.providers, ...(over.providers ?? {}) },
    tiers: { ...base.tiers, ...(over.tiers ?? {}) },
    profile: over.profile ?? base.profile,
    network: { ...base.network, ...(over.network ?? {}) },
    sandbox: { ...base.sandbox, ...(over.sandbox ?? {}) },
    limits: { ...base.limits, ...(over.limits ?? {}) },
    memory: { ...base.memory, ...(over.memory ?? {}) },
    coldStart: { ...base.coldStart, ...(over.coldStart ?? {}) },
    rag: { ...base.rag, ...(over.rag ?? {}) },
    mcpServers: { ...(base.mcpServers ?? {}), ...(over.mcpServers ?? {}) },
    channels: { ...(base.channels ?? {}), ...(over.channels ?? {}) },
    ...(over.remote ?? base.remote ? { remote: over.remote ?? base.remote } : {}),
    ...(over.email ?? base.email ? { email: over.email ?? base.email } : {}),
    autonomy: { ...base.autonomy, ...(over.autonomy ?? {}) },
  };
}

const PROFILES: Profile[] = ['read-only', 'assisted', 'trusted'];

export function validateConfig(cfg: HatsConfig): HatsConfig {
  if (!PROFILES.includes(cfg.profile)) {
    throw new HatsError('CONFIG_INVALID', `unknown profile "${cfg.profile}"`, {
      allowed: PROFILES,
    });
  }
  if (!cfg.providers[cfg.defaultProvider]) {
    throw new HatsError(
      'CONFIG_INVALID',
      `defaultProvider "${cfg.defaultProvider}" is not in providers`,
      { known: Object.keys(cfg.providers) },
    );
  }
  for (const [id, p] of Object.entries(cfg.providers)) {
    if (!p.kind) throw new HatsError('CONFIG_INVALID', `provider ${id} has no kind`, { id });
    if (p.kind !== 'mock' && !p.baseUrl) {
      throw new HatsError('CONFIG_INVALID', `provider ${id} has no baseUrl`, { id });
    }
  }
  for (const [tier, ref] of Object.entries(cfg.tiers)) {
    if (!ref) continue;
    const providerId = ref.includes('/') ? ref.slice(0, ref.indexOf('/')) : ref;
    if (!cfg.providers[providerId]) {
      throw new HatsError('CONFIG_INVALID', `tier ${tier} points at unknown provider`, {
        tier,
        ref,
      });
    }
  }
  if (cfg.limits.stepBudget < 1 || cfg.limits.stepBudget > 200) {
    throw new HatsError('CONFIG_INVALID', 'limits.stepBudget must be 1..200', {
      value: cfg.limits.stepBudget,
    });
  }
  return cfg;
}

/**
 * Resolve the credential for a provider. Precedence: explicit config key, then env var
 * from the provider config, then the preset's env var. Returns undefined for keyless
 * providers (Ollama, LM Studio) — that is not an error.
 */
export function resolveApiKey(id: string, p: ProviderConfig): string | undefined {
  return resolveApiKeyWithSource(id, p).key;
}

/**
 * Precedence: an explicit key in config (discouraged, kept for compatibility), then one
 * entered in the UI and stored 0600, then the environment. Explicit beats ambient, so a
 * key you deliberately saved is not silently overridden by a stale shell variable.
 */
export function resolveApiKeyWithSource(
  id: string,
  p: ProviderConfig,
): { key: string | undefined; source: KeySource } {
  if (p.apiKey) return { key: p.apiKey, source: 'config' };

  const stored = getCredential(id);
  if (stored) return { key: stored, source: 'stored' };

  const envName = p.apiKeyEnv ?? PRESETS[id]?.apiKeyEnv;
  if (envName) {
    const v = process.env[envName];
    if (v && v.trim()) return { key: v.trim(), source: 'env' };
  }
  return { key: undefined, source: null };
}

/** Which env var this provider would read, for `hats doctor` output. */
export function apiKeyEnvName(id: string, p: ProviderConfig): string | undefined {
  return p.apiKeyEnv ?? PRESETS[id]?.apiKeyEnv;
}

/**
 * Resolve a tier to a concrete `{providerId, model}`.
 * Falls back down the tiers (frontier -> standard -> light) rather than failing:
 * a local-only user with one model should not have to configure three.
 */
export function resolveTier(
  cfg: HatsConfig,
  tier: Tier,
): { providerId: string; provider: ProviderConfig; model: string } {
  const order: Tier[] = tier === 'frontier'
    ? ['frontier', 'standard', 'light']
    : tier === 'standard'
      ? ['standard', 'frontier', 'light']
      : ['light', 'standard', 'frontier'];

  for (const t of order) {
    const ref = cfg.tiers[t];
    if (ref && ref.includes('/')) {
      const providerId = ref.slice(0, ref.indexOf('/'));
      const model = ref.slice(ref.indexOf('/') + 1);
      const provider = cfg.providers[providerId];
      if (provider && model) return { providerId, provider, model };
    }
  }
  const providerId = cfg.defaultProvider;
  const provider = cfg.providers[providerId];
  if (!provider) {
    throw new HatsError('CONFIG_INVALID', `default provider ${providerId} missing`, {});
  }
  for (const t of order) {
    const m = provider.models?.[t];
    if (m) return { providerId, provider, model: m };
  }
  throw new HatsError(
    'CONFIG_MISSING',
    `no model configured for tier "${tier}". Run \`hats init\` or set tiers.${tier} to "provider/model".`,
    { providerId },
  );
}

export function homeSummary(): { home: string; config: string } {
  return { home: hatsHome(), config: path.join(hatsHome(), 'config.json') };
}
