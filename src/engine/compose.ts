/**
 * Composition: routing, the skill funnel, hat selection, tier routing, allowlist
 * intersection and the system prompt.
 *
 * Paper §2.6.4: the orchestrator "is not another model; it is the coded frame around the
 * one agent". Every decision in this file is made by code and logged. None of it consults
 * the model, which is what keeps governance out of the model's judgement budget.
 */

import type { HatsConfig, Profile, Tier } from '../core/config.js';
import type { Registry } from '../registry/loader.js';
import type { Rule, Skill } from '../registry/types.js';
import type { ToolHandler } from '../tools/types.js';

export const STAGES = ['intake', 'discover', 'plan', 'act', 'verify', 'deliver'] as const;
export type Stage = (typeof STAGES)[number];

const PROFILE_RANK: Record<Profile, number> = { 'read-only': 0, assisted: 1, trusted: 2 };

// --- 1. Routing -------------------------------------------------------------------

export interface RouteDecision {
  outcomeId: string;
  reason: string;
  matched: string[];
}

const ROUTE_SIGNALS: Array<{
  outcome: string;
  words: RegExp;
  needsWrite?: boolean;
  needsNetwork?: boolean;
}> = [
  {
    outcome: 'outcome/research',
    // Twice now this list has missed the obvious word and sent a plainly-web request to the
    // workspace skill, which has no fetch_url and no browser: first "research" ("research
    // about X and raise funds"), then "browser" ("use the browser, open en.wikipedia.org").
    // The original patterns described *how* someone might phrase a web lookup; real requests
    // just say what they want, and now also name the tool or the domain.
    // [Both seen in live runs, 2026-08-14.]
    words:
      /\b(https?:\/\/|[\w-]+\.(?:com|org|net|io|ai|co|gov|edu|in|uk|dev)\b|research|look ?up|look into|search|on the web|online|latest|current price|pricing page|changelog|release notes|documentation for|according to|find out(?: what| about)?|find information|tell me about|read up on|learn about|background on|who (?:is|are|was|were)|news about|reviews? of|compare|market|competitors?|website|web ?site|web ?page|contact details|charity|nonprofit|non-profit|organisation|organization|browser|browse|click|fill (?:in|out)?(?: the)? form|log ?in to|navigate to|visit)\b/i,
    needsNetwork: true,
  },
  {
    outcome: 'outcome/change',
    // "Write reports/incidents.md summarising X" is plainly a write, and the old pattern
    // only matched "write a file" / "write the test". It fell through to a read-only skill
    // whose allowlist has no write_file, so the standing grant that would have permitted
    // the write was never even consulted. [Seen in a live scheduled run, 2026-08-14.]
    words:
      /\b(edit|change|fix|patch|refactor|rename|add (?:a )?(?:function|file|test|field)|implement|update the|delete|remove the|build (?:me )?(?:a|an|the)?|make (?:me )?(?:a|an) (?:tool|connector|script|parser|adapter|integration)|create (?:a|an) (?:tool|connector|script|parser|adapter|integration|file))\b|\b(?:write|save|create|generate|append(?: to)?|output)\b[^.]{0,30}?(?:\b(?:a|the)\b\s+)?(?:file|report|summary|note|doc(?:ument)?|[\w./-]+\.[a-z]{1,5})\b/i,
    needsWrite: true,
  },
  {
    outcome: 'outcome/investigate',
    // "Security review of X. Where does it handle…" used to fall through to the answer
    // skill and run out of steps at 14 instead of investigate's 24, because the patterns
    // only matched "review the" and "where is". Real requests are not phrased that
    // tidily. [Seen in a live run, 2026-08-14.]
    words:
      /\b(investigate|audit|security review|code review|review (?:the|of|this)|how does|why does|why is|where does|where are|what stops|what prevents|trace|architecture|walk me through|understand|map out|where is|what happens when|explain the)\b/i,
  },
];

/**
 * Cheap, deterministic, logged (paper §2.6.4 step 1). Pattern work, not model judgement:
 * a router that costs a model call is a router you will be tempted to skip.
 */
export function route(
  request: string,
  registry: Registry,
  profile: Profile,
  override?: string,
  networkEnabled = false,
): RouteDecision {
  if (override) {
    return { outcomeId: override, reason: 'explicit --skill override', matched: [] };
  }
  for (const signal of ROUTE_SIGNALS) {
    const m = signal.words.exec(request);
    if (!m) continue;
    if (signal.needsNetwork && !networkEnabled) {
      // The intent is a web lookup but there is no egress. Route to the answer skill so
      // the agent says so, rather than to a skill whose only useful tool is absent.
      // Say how to fix it, in the reason the model sees. "I cannot access the internet"
      // is a true but useless answer when a one-line change makes it possible.
      return {
        outcomeId: 'outcome/answer',
        reason:
          `looks like a web lookup ("${m[0]}") but tool network egress is off — ` +
          `say so plainly and tell them to enable it with the --network flag, or in the ` +
          `panel under Setup, and offer to run it again once it is on`,
        matched: [m[0]],
      };
    }
    if (signal.needsWrite && PROFILE_RANK[profile] < PROFILE_RANK['assisted']) {
      // The intent is a change but the profile cannot make one. Route to the answer skill
      // and let the model say so, rather than routing to a skill whose tools are absent.
      return {
        outcomeId: 'outcome/answer',
        reason: `looks like a change request ("${m[0]}") but the profile is read-only`,
        matched: [m[0]],
      };
    }
    if (registry.find(signal.outcome)) {
      return { outcomeId: signal.outcome, reason: `matched "${m[0]}"`, matched: [m[0]] };
    }
  }

  // Registry-declared routing, so a promoted skill can actually be reached.
  //
  // ROUTE_SIGNALS is a fixed table of the four built-in outcomes. Until this existed, a
  // skill promoted from a proposal sat in the registry and was never selected by anything
  // — self-extension produced capability that could not be used, which is most of the
  // value of self-extension. An outcome skill now declares `triggers:` and competes here.
  // Placed after the built-in signals so a custom skill cannot quietly capture "fix this"
  // or "search the web", and before the default so it beats the generic fallback.
  // [Found by promoting a mined skill and watching run 4 route past it, 2026-08-14.]
  const lower = request.toLowerCase();
  const claimed = registry
    .outcomes()
    .filter((s) => s.triggers.length > 0)
    .map((s) => ({ skill: s, hits: s.triggers.filter((t) => matchesTrigger(lower, t)) }))
    .filter((c) => c.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length);

  // A skill whose allowlist cannot write must not claim a request that plainly needs to.
  // The mined incident-triage skill did exactly that to "write reports/incidents.md", and
  // the run then reported that write_file was unavailable — true, and entirely self-
  // inflicted. [Seen in a live scheduled run, 2026-08-14.]
  const WRITE_TOOLS = ['write_file', 'apply_patch', 'run_command'];
  const looksLikeWrite = ROUTE_SIGNALS.find((sig) => sig.outcome === 'outcome/change')?.words.test(request);
  const claimable = looksLikeWrite
    ? claimed.filter((c) => c.skill.tools.some((t) => WRITE_TOOLS.includes(t)))
    : claimed;

  const best = claimable[0];
  // Two triggers, so a single common word cannot hijack routing for every request.
  if (best && best.hits.length >= 2) {
    return {
      outcomeId: best.skill.id,
      reason: `${best.skill.id} declares ${best.hits.map((h) => `"${h}"`).join(', ')}`,
      matched: best.hits,
    };
  }

  return { outcomeId: 'outcome/answer', reason: 'default', matched: [] };
}

// --- 2. Skill funnel --------------------------------------------------------------

/**
 * Progressive disclosure (paper §2.3): essentials at run start, then a funnel keyed to
 * the active stage and outcome. Not a fixed ladder — a skill declares the stages it
 * attaches at, so context holds what this stage and the near horizon need.
 */
export function loadSkills(
  registry: Registry,
  outcome: Skill,
  stage: Stage,
  request: string,
): Skill[] {
  const selected = new Map<string, Skill>();
  const core = registry.find('core/discipline');
  if (core) selected.set(core.id, core);
  selected.set(outcome.id, outcome);

  const lowerRequest = request.toLowerCase();
  for (const skill of registry.skills) {
    if (skill.kind === 'behavioural') continue; // hats are injected per step, not funnelled
    if (selected.has(skill.id)) continue;
    const stageMatch = skill.stages.length === 0 || skill.stages.includes(stage);
    const outcomeMatch = skill.outcomes.length === 0 || skill.outcomes.includes(outcome.id);
    const triggerMatch =
      skill.triggers.length === 0 || skill.triggers.some((t) => lowerRequest.includes(t));
    if (skill.kind === 'cross-cutting' && stageMatch && outcomeMatch) selected.set(skill.id, skill);
    else if (skill.kind === 'domain' && outcomeMatch && triggerMatch) selected.set(skill.id, skill);
  }
  return [...selected.values()];
}

// --- 3. Hats ----------------------------------------------------------------------

export interface HatDecision {
  skill?: Skill;
  reason: string;
  /**
   * True when the hat was chosen by a rule rather than by keyword match. Only a
   * deterministic hat is allowed to narrow the allowlist — see buildAllowlist.
   */
  deterministic: boolean;
}

/**
 * The hat is chosen per step by code, from the stage, the pending intent and what just
 * happened — not by the model deciding which personality to be. Deterministic rules run
 * before keyword matching, because the important hats (guardian, reflector) must not
 * depend on the request containing the right word.
 */
export function selectHat(
  registry: Registry,
  opts: {
    stage: Stage;
    step: number;
    request: string;
    lastText: string;
    lastToolNames: string[];
    exhausted: boolean;
    reviewPass?: 'guardian' | 'critic';
    multiStep: boolean;
  },
): HatDecision {
  const byRole = (role: string) => registry.behavioural().find((s) => s.role === role);

  if (opts.reviewPass) {
    return {
      skill: byRole(opts.reviewPass),
      reason: `review pass required by the skill`,
      deterministic: true,
    };
  }
  if (opts.exhausted) {
    return { skill: byRole('reflector'), reason: 'step budget exhausted', deterministic: true };
  }
  if (opts.stage === 'plan' && opts.multiStep) {
    return {
      skill: byRole('planner'),
      reason: 'planning stage on multi-step work',
      deterministic: true,
    };
  }
  if (opts.lastToolNames.includes('sandbox_run')) {
    return { skill: byRole('coder'), reason: 'sandbox work in flight', deterministic: true };
  }
  if (opts.stage === 'deliver') {
    return { skill: byRole('communicator'), reason: 'composing the answer', deterministic: true };
  }

  // The request never changes, so matching against it puts the same hat on for every step
  // of a run — a request containing "review" wore the critic's playbook for all fourteen
  // steps of an investigation. After the opening steps, match against what is actually
  // happening now. [Seen in a live run, 2026-08-14.]
  const context = opts.step <= 2 ? `${opts.request} ${opts.lastText}` : opts.lastText;
  const lower = `${context} ${opts.lastToolNames.join(' ')}`.toLowerCase();
  const matches = registry
    .behavioural()
    .map((skill) => ({ skill, hits: skill.triggers.filter((t) => matchesTrigger(lower, t)).length }))
    .filter((m) => m.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const best = matches[0];
  if (best) {
    return { skill: best.skill, reason: `trigger match (${best.hits})`, deterministic: false };
  }

  return { reason: 'plain work — no hat injected', deterministic: false };
}

/**
 * Triggers match whole words, not substrings.
 *
 * [VERIFIED by a real run, 2026-08-14] Substring matching put the coder's hat on for
 * "How many **TypeScript** files…" — "script" is inside "TypeScript" — and because the
 * coder hat narrows the allowlist to sandbox tools, the run lost `list_dir` on step 1 and
 * never recovered. A wrong hat is a bad step; a wrong hat that removes tools is a dead run.
 */
/**
 * A trigger matches a whole word, allowing a common English suffix.
 *
 * The leading boundary is the part that matters and must stay strict: without it "script"
 * matched inside "TypeScript" and put the coder's hat on, which deleted `list_dir` on step
 * one of a live run. The trailing suffix is safe to relax and has to be, or a skill
 * declaring "incident" fails to match "incidents" — which is how most requests are
 * actually phrased. [Both found in live runs, 2026-08-14.]
 */
function matchesTrigger(haystack: string, trigger: string): boolean {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(s|es|ed|ing)?([^a-z0-9]|$)`, 'i').test(haystack);
}

/**
 * Only review hats may narrow the allowlist.
 *
 * The paper's guardian has "a tools list containing only validation tools", and that is
 * right for hats injected deterministically at the verify boundary. It is wrong for hats
 * chosen by keyword during work: a mis-selected coder must not be able to delete the file
 * tools the run needs. Selection is heuristic; capability removal should not be.
 */
// The reflector is deliberately absent. It is a delivery pass, not a review pass, and
// stripping its tools produced "not permitted by the active skill's allowlist" on the last
// step of a run that had simply run out of room — a permission error for something that was
// never a permission problem. [Seen in a live run, 2026-08-15.]
const NARROWING_ROLES = new Set(['guardian', 'critic']);

// --- 4. Model tier ----------------------------------------------------------------

/**
 * Semantic routing (paper §2.2): synthesis and hard recovery earn the frontier model;
 * extraction and formatting stay cheaper. Cost pressure can downgrade. This is a coded
 * seam — no field the model can set reaches it.
 */
export function routeTier(opts: {
  stage: Stage;
  hat?: Skill;
  outcome: Skill;
  contextChars: number;
  budgetChars: number;
}): { tier: Tier; reason: string } {
  if (opts.contextChars > opts.budgetChars * 0.9) {
    return { tier: 'light', reason: 'context near its ceiling — downgraded under cost pressure' };
  }
  if (opts.hat?.tier) return { tier: opts.hat.tier, reason: `hat ${opts.hat.role} declares it` };
  if (opts.stage === 'discover') return { tier: 'standard', reason: 'discovery is extraction work' };
  if (opts.stage === 'plan' || opts.stage === 'verify' || opts.stage === 'deliver') {
    return { tier: 'frontier', reason: `${opts.stage} is judgement work` };
  }
  return { tier: opts.outcome.tier ?? 'standard', reason: 'outcome skill default' };
}

// --- 5. Allowlist -----------------------------------------------------------------

export interface AllowlistDecision {
  allowlist: Set<string>;
  dropped: Array<{ tool: string; why: string }>;
}

/**
 * Intersection, never union (rule/allowlist-intersection). A skill cannot grant what the
 * profile withholds, and a profile cannot grant what the skill does not list.
 */
export function buildAllowlist(
  skill: Skill,
  handlers: ToolHandler[],
  config: HatsConfig,
  profile: Profile,
  hat?: Skill,
  /**
   * False when the hat was chosen by keyword rather than by rule. A keyword-selected
   * guardian appearing mid-work must not delete the tools the run is using; only the
   * deterministic review pass narrows. [Found by a real run, 2026-08-14.]
   */
  hatMayNarrow = true,
): AllowlistDecision {
  const platform = new Map(handlers.map((h) => [h.spec.name, h]));
  const allowlist = new Set<string>();
  const dropped: Array<{ tool: string; why: string }> = [];

  // A review hat with a declared tool list narrows further (paper §2.6.1). Work hats do
  // not — see NARROWING_ROLES above for why that distinction is load-bearing.
  const hatTools =
    hatMayNarrow && hat && hat.tools.length > 0 && hat.role && NARROWING_ROLES.has(hat.role)
      ? new Set(hat.tools)
      : null;

  // A skill may name a tool exactly, or with a trailing wildcard — `mcp__playwright__*`.
  // MCP tool names are only known once a server is connected, so requiring a skill edit
  // per tool would make MCP unusable from skills.
  const requested: string[] = [];
  for (const pattern of skill.tools) {
    if (!pattern.includes('*')) {
      requested.push(pattern);
      continue;
    }
    const matched = [...platform.keys()].filter((name) => matchesGlob(name, pattern));
    if (matched.length === 0) dropped.push({ tool: pattern, why: 'no tool matches this pattern' });
    requested.push(...matched);
  }

  for (const name of requested) {
    const handler = platform.get(name);
    if (!handler) {
      dropped.push({ tool: name, why: 'not in the platform registry' });
      continue;
    }
    if (PROFILE_RANK[profile] < PROFILE_RANK[handler.spec.minProfile]) {
      dropped.push({ tool: name, why: `needs the ${handler.spec.minProfile} profile` });
      continue;
    }
    if (handler.spec.network && !config.network.enabled) {
      dropped.push({ tool: name, why: 'network egress is disabled' });
      continue;
    }
    if (hatTools && !hatTools.has(name)) {
      dropped.push({ tool: name, why: `the ${hat?.role} hat does not permit it` });
      continue;
    }
    allowlist.add(name);
  }
  return { allowlist, dropped };
}

/** `mcp__*`, `mcp__playwright__*`, `read_*` — `*` matches any run of characters. */
export function matchesGlob(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

// --- 6. System prompt -------------------------------------------------------------

export interface PromptInput {
  skills: Skill[];
  hat?: Skill;
  rules: Rule[];
  memoryBlock: string;
  workspaceRoot: string;
  profile: Profile;
  /** Stated in the prompt rather than left for the model to infer from memory. */
  networkEnabled?: boolean;
  stage: Stage;
  stepsLeft: number;
  conservative: boolean;
}

/**
 * Composed context, in a fixed order: identity, situation, memory, playbooks, the hat,
 * then the rules. Rules last because they are what the model should be holding when it
 * decides what to do next.
 */
/**
 * Split into a stable prefix and a volatile tail, and the order is the whole point.
 *
 * Prompt caching — Anthropic's explicit kind, OpenAI's automatic kind, Gemini's implicit
 * kind — all key on an unchanged *prefix*. This prompt used to open with
 * "Stage: act. Steps remaining: 9", which changes every single step, so the prefix died at
 * about token 40 and every step re-paid for the entire system prompt, skills and rules
 * included. Anything that changes per step now lives at the end, after the cache
 * breakpoint. [Found while asking why runs cost what they cost, 2026-08-14.]
 */
export interface SystemPrompt {
  /** Identical across steps of a run. Cacheable. */
  stable: string;
  /** Stage, budget and the current hat. Changes per step; deliberately last. */
  volatile: string;
  /** stable + volatile, for providers with no caching concept. */
  full: string;
}

export function buildSystemPrompt(input: PromptInput): string {
  return buildSystemParts(input).full;
}

export function buildSystemParts(input: PromptInput): SystemPrompt {
  const parts: string[] = [];

  parts.push(
    [
      'You are hats: one agent that changes hats, running locally on this machine.',
      '',
      `Workspace root: ${input.workspaceRoot}`,
      `Profile: ${input.profile}${input.profile === 'read-only' ? ' (you cannot modify anything — say so plainly if asked to)' : ''}`,
      // Stated by code, because the model was inferring it from memory and getting it
      // wrong. A run that failed with egress off left takeaways and a persona fact saying
      // so; later runs then refused to call fetch_url — which was in their allowlist the
      // whole time — and told the user the network was off after they had turned it on.
      // Memory can be stale; this line cannot. [Seen in a live run, 2026-08-14.]
      input.networkEnabled
        ? 'Tool network egress: ON. Tools that reach the internet work right now. If you have a memory suggesting otherwise, it is stale — ignore it and call the tool.'
        : 'Tool network egress: OFF. Tools that reach the internet are absent from your list. Say so and name what you would have fetched.',
      'You act only through the tools you were given. There is no other way to affect anything.',
    ].join('\n'),
  );

  if (input.conservative) {
    parts.push(
      '## Conservative mode\n\nThis workspace is new: there is little memory of it and none of you. Prefer asking over assuming, keep claims narrow, and check before you conclude. This relaxes as memory accumulates.',
    );
  }

  if (input.memoryBlock) parts.push(`# Memory\n\n${input.memoryBlock}`);

  for (const skill of input.skills) {
    parts.push(`# Skill: ${skill.id} (v${skill.version})\n\n${skill.body}`);
  }

  const prompted = input.rules.filter((r) => r.strength === 'prompt');
  const structural = input.rules.filter((r) => r.strength !== 'prompt');
  const ruleLines: string[] = [];
  if (prompted.length > 0) {
    ruleLines.push(
      '## Held by instruction\n',
      ...prompted.map((r) => `- **${r.id}** — ${r.statement}`),
    );
  }
  if (structural.length > 0) {
    ruleLines.push(
      '',
      '## Held by code, whatever you decide\n',
      'These are already true. Attempting to work around them wastes steps; the boundary is not in this prompt.\n',
      ...structural.map((r) => `- **${r.id}** (${r.strength}) — ${r.statement}`),
    );
  }
  if (ruleLines.length > 0) parts.push(`# Rules\n\n${ruleLines.join('\n')}`);

  const stable = parts.join('\n\n---\n\n');

  // Everything below this line changes step to step and therefore sits after the cache
  // breakpoint, where it costs a few tokens instead of invalidating everything above it.
  const tail: string[] = [
    `# This step\n\nStage: ${input.stage}. Steps remaining: ${input.stepsLeft}.`,
  ];
  if (input.hat) {
    tail.push(
      `# Hat: ${input.hat.role} — wear this for this step only\n\n${input.hat.body}\n\nWhen this step is done, take the hat off. You are still the same agent with the same transcript.`,
    );
  }
  const volatile = tail.join('\n\n---\n\n');

  return { stable, volatile, full: stable + '\n\n---\n\n' + volatile };
}
