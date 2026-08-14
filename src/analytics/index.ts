/**
 * Analytics, computed from the run records rather than from a separate telemetry pipe.
 *
 * Every number here already existed on disk — that is the point of writing a full record
 * per run. Nothing is sent anywhere, and turning analytics off would just mean not reading
 * your own files.
 *
 * The metrics are chosen to answer questions the architecture actually raises. The paper
 * names three that would settle its central claim (§7.2): cost per completed outcome, how
 * long error attribution takes, and whether a regression can be isolated. The first is
 * here directly; the second and third are what gate-failure and denial breakdowns are for.
 *
 * On cost: tokens are always counted. Money is only shown for models that match the
 * OpenRouter catalogue, and runs that could not be priced are reported as unpriced rather
 * than folded in as zero — a total that quietly undercounts is worse than one that says
 * what it missed.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';

import { workspaceDir } from '../core/paths.js';
import { readJson } from '../core/store.js';
import { catalogue, quote, type CatalogueEntry } from '../ui/pricing.js';

export interface RunRecord {
  runId: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  request?: string;
  profile?: string;
  outcomeId?: string;
  steps?: number;
  stepBudget?: number;
  ok?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; cacheWriteTokens?: number; cacheReadTokens?: number };
  modelsUsed?: string[];
  protocolDowngraded?: boolean;
  gateFindings?: Array<{ ruleId: string; passed: boolean; detail: string }>;
  observations?: Array<{ tool: string; ok: boolean; ruleId?: string; durationMs?: number }>;
  conservative?: boolean;
  sandboxDescriptors?: string[];
}

export interface Analytics {
  workspace: string;
  runs: number;
  window: { from: string | null; to: string | null };
  completion: { ok: number; partial: number; rate: number };
  steps: { total: number; mean: number; budgetExhausted: number };
  duration: { totalMs: number; meanMs: number; p90Ms: number };
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
  cost: {
    usd: number;
    pricedRuns: number;
    unpricedRuns: number;
    /** Model ids we could not price, so the gap is nameable rather than invisible. */
    unpricedModels: string[];
    perCompletedOutcome: number | null;
  };
  models: Array<{ model: string; runs: number; tokensIn: number; tokensOut: number; usd: number | null }>;
  outcomes: Array<{ outcome: string; runs: number; okRate: number }>;
  tools: Array<{ tool: string; calls: number; failures: number; denials: number }>;
  gates: Array<{ ruleId: string; checks: number; failures: number }>;
  denials: Array<{ ruleId: string; count: number }>;
  degradedRuns: number;
  sandboxDescriptors: Array<{ descriptor: string; count: number }>;
  daily: Array<{ day: string; runs: number; tokens: number; usd: number }>;
}

export async function computeAnalytics(slug: string, limit = 500): Promise<Analytics> {
  const runsDir = path.join(workspaceDir(slug), 'runs');
  let ids: string[] = [];
  try {
    ids = (await fsp.readdir(runsDir)).sort().slice(-limit);
  } catch {
    ids = [];
  }

  const records: RunRecord[] = [];
  for (const id of ids) {
    const record = await readJson<RunRecord | null>(path.join(runsDir, id, 'run.json'), null);
    if (record) records.push(record);
  }

  const prices = await catalogue().catch((): CatalogueEntry[] => []);

  const tools = new Map<string, { calls: number; failures: number; denials: number }>();
  const gates = new Map<string, { checks: number; failures: number }>();
  const denials = new Map<string, number>();
  const models = new Map<string, { runs: number; tokensIn: number; tokensOut: number; usd: number | null }>();
  const outcomes = new Map<string, { runs: number; ok: number }>();
  const descriptors = new Map<string, number>();
  const daily = new Map<string, { runs: number; tokens: number; usd: number }>();
  const unpricedModels = new Set<string>();

  let ok = 0;
  let stepsTotal = 0;
  let exhausted = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  let usd = 0;
  let pricedRuns = 0;
  let unpricedRuns = 0;
  let degraded = 0;
  const durations: number[] = [];

  for (const r of records) {
    if (r.ok) ok++;
    stepsTotal += r.steps ?? 0;
    if ((r.steps ?? 0) >= (r.stepBudget ?? Infinity)) exhausted++;
    if (r.protocolDowngraded) degraded++;
    if (r.durationMs) durations.push(r.durationMs);

    const inTok = r.usage?.inputTokens ?? 0;
    const outTok = r.usage?.outputTokens ?? 0;
    inputTokens += inTok;
    outputTokens += outTok;
    const cw = r.usage?.cacheWriteTokens ?? 0;
    const cr = r.usage?.cacheReadTokens ?? 0;
    cacheWrite += cw;
    cacheRead += cr;

    // A run may touch several models; attribute tokens to the first, which is the one
    // that did the bulk of the work in practice, and say so rather than splitting evenly
    // on a guess.
    const primary = r.modelsUsed?.[0] ?? 'unknown';
    const m = models.get(primary) ?? { runs: 0, tokensIn: 0, tokensOut: 0, usd: 0 };
    m.runs++;
    m.tokensIn += inTok;
    m.tokensOut += outTok;

    const runCost = priceRun(prices, primary, inTok, outTok, cw, cr);
    if (runCost === null) {
      unpricedRuns++;
      if (primary !== 'unknown') unpricedModels.add(primary);
      m.usd = null;
    } else {
      pricedRuns++;
      usd += runCost;
      if (m.usd !== null) m.usd += runCost;
    }
    models.set(primary, m);

    const outcome = r.outcomeId ?? 'unknown';
    const o = outcomes.get(outcome) ?? { runs: 0, ok: 0 };
    o.runs++;
    if (r.ok) o.ok++;
    outcomes.set(outcome, o);

    for (const obs of r.observations ?? []) {
      const t = tools.get(obs.tool) ?? { calls: 0, failures: 0, denials: 0 };
      t.calls++;
      if (!obs.ok) t.failures++;
      if (obs.ruleId) {
        t.denials++;
        denials.set(obs.ruleId, (denials.get(obs.ruleId) ?? 0) + 1);
      }
      tools.set(obs.tool, t);
    }

    for (const g of r.gateFindings ?? []) {
      const entry = gates.get(g.ruleId) ?? { checks: 0, failures: 0 };
      entry.checks++;
      if (!g.passed) entry.failures++;
      gates.set(g.ruleId, entry);
    }

    for (const d of r.sandboxDescriptors ?? []) {
      descriptors.set(d, (descriptors.get(d) ?? 0) + 1);
    }

    const day = (r.startedAt ?? '').slice(0, 10);
    if (day) {
      const entry = daily.get(day) ?? { runs: 0, tokens: 0, usd: 0 };
      entry.runs++;
      entry.tokens += inTok + outTok;
      entry.usd += runCost ?? 0;
      daily.set(day, entry);
    }
  }

  durations.sort((a, b) => a - b);
  const totalMs = durations.reduce((a, b) => a + b, 0);

  return {
    workspace: slug,
    runs: records.length,
    window: {
      from: records[0]?.startedAt ?? null,
      to: records[records.length - 1]?.startedAt ?? null,
    },
    completion: {
      ok,
      partial: records.length - ok,
      rate: records.length ? Number((ok / records.length).toFixed(3)) : 0,
    },
    steps: {
      total: stepsTotal,
      mean: records.length ? Number((stepsTotal / records.length).toFixed(1)) : 0,
      budgetExhausted: exhausted,
    },
    duration: {
      totalMs,
      meanMs: durations.length ? Math.round(totalMs / durations.length) : 0,
      p90Ms: durations.length ? (durations[Math.floor(durations.length * 0.9)] ?? 0) : 0,
    },
    tokens: { input: inputTokens, output: outputTokens, cacheWrite, cacheRead },
    cost: {
      usd: Number(usd.toFixed(4)),
      pricedRuns,
      unpricedRuns,
      unpricedModels: [...unpricedModels],
      perCompletedOutcome: ok > 0 && pricedRuns > 0 ? Number((usd / ok).toFixed(4)) : null,
    },
    models: [...models.entries()]
      .map(([model, v]) => ({
        model,
        runs: v.runs,
        tokensIn: v.tokensIn,
        tokensOut: v.tokensOut,
        usd: v.usd === null ? null : Number(v.usd.toFixed(4)),
      }))
      .sort((a, b) => b.runs - a.runs),
    outcomes: [...outcomes.entries()]
      .map(([outcome, v]) => ({
        outcome,
        runs: v.runs,
        okRate: Number((v.ok / v.runs).toFixed(2)),
      }))
      .sort((a, b) => b.runs - a.runs),
    tools: [...tools.entries()]
      .map(([tool, v]) => ({ tool, ...v }))
      .sort((a, b) => b.calls - a.calls),
    gates: [...gates.entries()]
      .map(([ruleId, v]) => ({ ruleId, ...v }))
      .sort((a, b) => b.failures - a.failures || b.checks - a.checks),
    denials: [...denials.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => b.count - a.count),
    degradedRuns: degraded,
    sandboxDescriptors: [...descriptors.entries()]
      .map(([descriptor, count]) => ({ descriptor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    daily: [...daily.entries()]
      .map(([day, v]) => ({ day, runs: v.runs, tokens: v.tokens, usd: Number(v.usd.toFixed(4)) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** null means "we could not price this", which is reported, never treated as zero. */
function priceRun(
  prices: CatalogueEntry[],
  modelRef: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
): number | null {
  if (!modelRef || modelRef === 'unknown') return null;
  const slash = modelRef.indexOf('/');
  const providerId = slash === -1 ? modelRef : modelRef.slice(0, slash);
  const model = slash === -1 ? modelRef : modelRef.slice(slash + 1);

  // Local servers genuinely cost nothing per token; that is a real zero, not a missing one.
  if (providerId === 'ollama' || providerId === 'lmstudio' || providerId === 'vllm') return 0;

  const q = quote(prices, providerId, model);
  if (!q || (q.promptPerM === undefined && q.completionPerM === undefined)) return null;
  // Cached tokens are billed at their own published rates, not at the input rate — using
  // the input rate would quietly erase the saving the cache exists to produce.
  return (
    (inputTokens / 1_000_000) * (q.promptPerM ?? 0) +
    (outputTokens / 1_000_000) * (q.completionPerM ?? 0) +
    (cacheWriteTokens / 1_000_000) * (q.cacheWritePerM ?? q.promptPerM ?? 0) +
    (cacheReadTokens / 1_000_000) * (q.cacheReadPerM ?? 0)
  );
}
