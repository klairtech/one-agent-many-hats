/**
 * The runtime registry (paper §4, "the runtime registry as constitution").
 *
 * `packs/` in the installed package is the authoring source of truth. `$HATS_HOME/registry`
 * is what runs load. Sync copies authoring -> runtime; the agent can propose into
 * `registry/proposals/**` but nothing it writes is ever loaded as live (REPO_RULES §4.4).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from '../core/errors.js';
import { packDir, registryDir } from '../core/paths.js';
import { ensureDir, exists, listFiles } from '../core/store.js';
import {
  asBoolean,
  asEnum,
  asList,
  asNumber,
  asOptionalString,
  asString,
  parseDocument,
} from './frontmatter.js';
import type {
  ReviewRequirement,
  RoleName,
  Rule,
  RuleStrength,
  Skill,
  SkillKind,
  RegistrySnapshot,
} from './types.js';

const SKILL_KINDS = ['outcome', 'cross-cutting', 'domain', 'behavioural'] as const;
const REVIEWS = ['none', 'guardian', 'critic'] as const;
const STRENGTHS = ['prompt', 'gate', 'code'] as const;
const ROLES = [
  'orchestrator',
  'planner',
  'evaluator',
  'coder',
  'guardian',
  'critic',
  'reflector',
  'communicator',
  'visual-communicator',
] as const;
const TIERS = ['light', 'standard', 'frontier'] as const;
const VIOLATIONS = ['block', 'warn', 'block_and_reshape'] as const;

export interface LoadOptions {
  /** Names the gate registry knows how to enforce; gate rules must name one of them. */
  knownGates?: Set<string>;
  root?: string;
}

export class Registry {
  private constructor(
    readonly skills: Skill[],
    readonly rules: Rule[],
    readonly root: string,
    readonly loadedAt: string,
  ) {}

  static async load(opts: LoadOptions = {}): Promise<Registry> {
    const root = opts.root ?? registryDir();
    await syncPacks(root);

    const skillFiles = await listFiles(path.join(root, 'skills'), '.md');
    const ruleFiles = await listFiles(path.join(root, 'rules'), '.md');

    const skills: Skill[] = [];
    for (const file of skillFiles) skills.push(parseSkill(await fsp.readFile(file, 'utf8'), file));
    const rules: Rule[] = [];
    for (const file of ruleFiles) rules.push(parseRule(await fsp.readFile(file, 'utf8'), file));

    assertUniqueIds(skills.map((s) => s.id), 'skill');
    assertUniqueIds(rules.map((r) => r.id), 'rule');

    if (opts.knownGates) {
      // Both gate- and code-strength rules must name an enforcement point that exists.
      // `enforced_by` is what turns a rule from documentation into a checkable claim:
      // you can audit that the named code path exists and cites the rule back.
      for (const rule of rules) {
        if (rule.strength === 'prompt') continue;
        if (!rule.enforcedBy || !opts.knownGates.has(rule.enforcedBy)) {
          throw new HatsError(
            'REGISTRY_INVALID',
            `${rule.source}: ${rule.strength}-strength rule "${rule.id}" names enforced_by "${rule.enforcedBy ?? '(none)'}" which is not a registered enforcement point. A rule that names no enforcement point is not enforceable.`,
            { rule: rule.id, known: [...opts.knownGates] },
          );
        }
      }
    }

    return new Registry(skills, rules, root, new Date().toISOString());
  }

  skill(id: string): Skill {
    const found = this.skills.find((s) => s.id === id);
    if (!found) {
      throw new HatsError('REGISTRY_NOT_FOUND', `no skill "${id}" in the registry`, {
        known: this.skills.map((s) => s.id),
      });
    }
    return found;
  }

  find(id: string): Skill | undefined {
    return this.skills.find((s) => s.id === id);
  }

  byKind(kind: SkillKind): Skill[] {
    return this.skills.filter((s) => s.kind === kind);
  }

  behavioural(): Skill[] {
    return this.byKind('behavioural');
  }

  outcomes(): Skill[] {
    return this.byKind('outcome');
  }

  rule(id: string): Rule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  /**
   * Rules attach by scope (paper §2.4): a rule with empty scope is always on; otherwise
   * it attaches when any scope token matches the active stage, an active tool, the
   * profile, or the active outcome id.
   */
  rulesInScope(active: {
    stage?: string;
    tools?: string[];
    profile?: string;
    outcome?: string;
  }): Rule[] {
    const tokens = new Set<string>();
    if (active.stage) tokens.add(active.stage);
    if (active.profile) tokens.add(active.profile);
    if (active.outcome) tokens.add(active.outcome);
    for (const t of active.tools ?? []) tokens.add(t);
    return this.rules.filter((r) => r.scope.length === 0 || r.scope.some((s) => tokens.has(s)));
  }

  snapshot(): RegistrySnapshot {
    const versions: Record<string, number> = {};
    for (const s of this.skills) versions[s.id] = s.version;
    for (const r of this.rules) versions[r.id] = r.version;
    return { skills: this.skills, rules: this.rules, versions, loadedAt: this.loadedAt };
  }
}

/**
 * Deploy-time sync, paper §4: "deploy syncs the registry; deletes are denied so history
 * accumulates as versions". A file already present in the runtime registry is never
 * overwritten by a pack unless `force` — the user's edits win over the shipped defaults.
 */
export async function syncPacks(root = registryDir(), force = false): Promise<string[]> {
  const copied: string[] = [];
  for (const kind of ['skills', 'rules'] as const) {
    const from = path.join(packDir(), kind);
    const to = await ensureDir(path.join(root, kind));
    for (const file of await listFiles(from, '.md')) {
      const target = path.join(to, path.basename(file));
      if (!force && (await exists(target))) continue;
      await fsp.copyFile(file, target);
      copied.push(target);
    }
  }
  await ensureDir(path.join(root, 'proposals', 'skills'));
  await ensureDir(path.join(root, 'proposals', 'rules'));
  await ensureDir(path.join(root, 'proposals', 'tools'));
  return copied;
}

export function parseSkill(raw: string, source: string): Skill {
  const { frontmatter: fm, body } = parseDocument(raw, source);
  const kind = asEnum<SkillKind>(fm, 'kind', SKILL_KINDS, 'cross-cutting', source);
  const skill: Skill = {
    id: asString(fm, 'id', source),
    kind,
    version: asNumber(fm, 'version', 1),
    description: asOptionalString(fm, 'description') ?? '',
    tools: asList(fm, 'tools'),
    deterministicSeed: asBoolean(fm, 'deterministic_seed', false),
    stages: asList(fm, 'stages'),
    outcomes: asList(fm, 'outcomes'),
    triggers: asList(fm, 'triggers').map((t) => t.toLowerCase()),
    review: asEnum<ReviewRequirement>(fm, 'review', REVIEWS, 'none', source),
    body,
    source,
  };
  const budget = asNumber(fm, 'step_budget', 0);
  if (budget > 0) skill.stepBudget = budget;
  const role = asOptionalString(fm, 'role');
  if (role) {
    if (!(ROLES as readonly string[]).includes(role)) {
      throw new HatsError('REGISTRY_INVALID', `${source}: unknown role "${role}"`, {
        allowed: ROLES,
      });
    }
    skill.role = role as RoleName;
  }
  if (kind === 'behavioural' && !skill.role) {
    throw new HatsError('REGISTRY_INVALID', `${source}: behavioural skills must declare a role`, {
      id: skill.id,
    });
  }
  const tier = asOptionalString(fm, 'tier');
  if (tier) {
    if (!(TIERS as readonly string[]).includes(tier)) {
      throw new HatsError('REGISTRY_INVALID', `${source}: unknown tier "${tier}"`, {
        allowed: TIERS,
      });
    }
    skill.tier = tier as Skill['tier'];
  }
  return skill;
}

export function parseRule(raw: string, source: string): Rule {
  const { frontmatter: fm, body } = parseDocument(raw, source);
  const strength = asEnum<RuleStrength>(fm, 'strength', STRENGTHS, 'prompt', source);
  const rule: Rule = {
    id: asString(fm, 'id', source),
    statement: asString(fm, 'statement', source),
    strength,
    scope: asList(fm, 'scope'),
    onViolation: asEnum(fm, 'on_violation', VIOLATIONS, 'block', source),
    history: asList(fm, 'history'),
    version: asNumber(fm, 'version', 1),
    body,
    source,
  };
  const enforcedBy = asOptionalString(fm, 'enforced_by');
  if (enforcedBy) rule.enforcedBy = enforcedBy;
  if (strength !== 'prompt' && !enforcedBy) {
    throw new HatsError(
      'REGISTRY_INVALID',
      `${source}: rule "${rule.id}" is strength "${strength}" but names no enforced_by`,
      { id: rule.id },
    );
  }
  return rule;
}

function assertUniqueIds(ids: string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new HatsError('REGISTRY_INVALID', `duplicate ${what} id "${id}"`, { id });
    }
    seen.add(id);
  }
}
