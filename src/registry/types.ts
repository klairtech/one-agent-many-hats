/**
 * The declarative trinity, as types. Paper §2.
 *
 * Skills and Rules are documents on disk. Tools are code with a typed spec. All three are
 * versioned; a run records the version of everything it loaded, because when a run
 * misbehaves the first question is which version of which skill was in context.
 */

import type { Tier } from '../core/config.js';
import type { JsonSchema } from '../providers/types.js';

/** Paper §2.3. Four layers that compose per run. */
export type SkillKind = 'outcome' | 'cross-cutting' | 'domain' | 'behavioural';

/** Paper §2.2. The hats. `role` on a behavioural skill names which one. */
export type RoleName =
  | 'orchestrator'
  | 'planner'
  | 'evaluator'
  | 'coder'
  | 'guardian'
  | 'critic'
  | 'reflector'
  | 'communicator'
  | 'visual-communicator';

export type ReviewRequirement = 'none' | 'guardian' | 'critic';

export interface Skill {
  id: string;
  kind: SkillKind;
  version: number;
  description: string;
  /** The allowlist. The executor enforces this; the prompt does not. */
  tools: string[];
  stepBudget?: number;
  deterministicSeed: boolean;
  /** Stage names at which the funnel attaches this skill (progressive disclosure). */
  stages: string[];
  /** Outcome ids this skill attaches to; empty means "any". */
  outcomes: string[];
  /** Lowercase trigger words matched against the pending task, for behavioural skills. */
  triggers: string[];
  review: ReviewRequirement;
  role?: RoleName;
  /** Preferred competence tier when this skill is the active hat (router input, not law). */
  tier?: Tier;
  body: string;
  source: string;
}

/** Paper §2.4. Strength is declared by the rule, not by the engine. */
export type RuleStrength = 'prompt' | 'gate' | 'code';

export interface Rule {
  id: string;
  statement: string;
  strength: RuleStrength;
  /** Stage names, tool names or profile names this rule attaches to; empty = always. */
  scope: string[];
  /**
   * The named code path that holds this rule. For `gate` rules it must resolve to a
   * registered check, or loading fails: a rule that names no enforcement point is not
   * enforceable (paper §2.6.2).
   */
  enforcedBy?: string;
  onViolation: 'block' | 'warn' | 'block_and_reshape';
  /** Promotion ladder, paper §2.4: prompt -> gate -> code, recorded as it happened. */
  history: string[];
  version: number;
  body: string;
  source: string;
}

/** Paper §2.5. Tools are the agent's entire action surface. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Read-only tools are available in every profile (ADR-0005). */
  mutating: boolean;
  /** Requires network egress; refused unless network.enabled. */
  network: boolean;
  /** Minimum profile that may use this tool. */
  minProfile: 'read-only' | 'assisted' | 'trusted';
  /** Cap on the observation returned to the model, in characters. */
  maxSummaryChars?: number;
  /**
   * Check required fields, then pass the arguments through untouched. Used for tools
   * whose schema we did not author — an MCP server owns its own dialect, and rejecting
   * valid input because our JSON-Schema subset does not model it would be our bug
   * presented as the model's.
   */
  passthroughInput?: boolean;
  /** Present in the model's tool list only when this predicate passes. */
  availableWhen?: (ctx: { profile: string; networkEnabled: boolean }) => boolean;
}

export interface RegistrySnapshot {
  skills: Skill[];
  rules: Rule[];
  /** id -> version, recorded in the run record. */
  versions: Record<string, number>;
  loadedAt: string;
}
