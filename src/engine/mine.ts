/**
 * Recurrence mining: turning "this keeps happening" into a proposal.
 *
 * Paper §4 says capability should be born where flexibility is cheap and graduate as it
 * earns trust, and that the evidence for graduating is **repetition**. The staging tools
 * (`propose_skill`, `propose_tool`) have always existed, but nothing produced the evidence:
 * `recordTaskDescriptor` collected descriptors into the run record and no code ever read
 * them back. Self-extension was therefore entirely dependent on the model spontaneously
 * deciding to propose something, which it rarely does.
 *
 * This closes that loop. It reads run records already on disk, groups work that looks the
 * same, and stages a proposal when a group crosses the threshold. It proposes only — every
 * promotion path is unchanged, and a tool proposal still cannot become a tool without a
 * human writing the handler (ADR-0006).
 */

import path from 'node:path';

import type { HatsConfig } from '../core/config.js';
import { Logger } from '../core/logger.js';
import { workspaceDir } from '../core/paths.js';
import { readJson } from '../core/store.js';
import { listProposals, stageProposal } from '../registry/proposals.js';

interface RunRecord {
  runId?: string;
  request?: string;
  outcomeId?: string;
  ok?: boolean;
  sandboxDescriptors?: string[];
  finishedAt?: string;
  observations?: Array<{
    tool: string;
    ok: boolean;
    summary?: string;
    errorCode?: string;
    ruleId?: string;
  }>;
}

export interface MinedProposal {
  kind: 'skill' | 'tool';
  title: string;
  occurrences: number;
  proposalId: string;
}

/** How many run records to consider. Older work is not evidence about today. */
const WINDOW = 40;
/** Token overlap above which two pieces of work are "the same kind". */
const SIMILARITY = 0.5;

export async function mineProposals(
  slug: string,
  config: HatsConfig,
  logger = new Logger({ base: { component: 'mine' } }),
): Promise<MinedProposal[]> {
  const threshold = Math.max(2, config.autonomy.promoteAfterOccurrences ?? 3);
  const runs = await recentRuns(slug);
  if (runs.length < threshold) return [];

  const existing = await listProposals();
  const alreadyProposed = (title: string) =>
    existing.some((p) => similar(tokens(p.title), tokens(title)) >= SIMILARITY);

  const out: MinedProposal[] = [];

  // --- recurring sandbox computations become candidate tools (the paper's own signal) ---
  const descriptorGroups = group(
    runs.flatMap((r) => (r.sandboxDescriptors ?? []).map((d) => ({ text: d, run: r }))),
  );
  for (const g of descriptorGroups) {
    if (g.items.length < threshold || alreadyProposed(g.label)) continue;
    const proposal = await stageProposal({
      kind: 'tool',
      title: g.label,
      rationale:
        `The same computation has been written by hand in the sandbox ${g.items.length} times ` +
        `(${g.items.map((i) => i.run.runId).filter(Boolean).slice(0, 6).join(', ')}). ` +
        `Written fresh each run it is unreviewed code with no schema and no gates; as a named ` +
        `tool it gets both. Descriptors seen: ${unique(g.items.map((i) => i.text)).slice(0, 5).join(' · ')}.`,
      content: toolContract(g.label, g.items.map((i) => i.text)),
      evidence: g.items.map((i) => `${i.run.runId ?? 'unknown'}: ${i.text}`).slice(0, 12),
    });
    out.push({ kind: 'tool', title: g.label, occurrences: g.items.length, proposalId: proposal.id });
  }

  // --- recurring kinds of request with no playbook become candidate skills ---
  // Only runs routed to the generic outcome count: work that already has a specific skill
  // is not evidence that a skill is missing.
  const generic = runs.filter((r) => r.outcomeId === 'outcome/answer' && r.request);
  const requestGroups = group(generic.map((r) => ({ text: r.request as string, run: r })));
  for (const g of requestGroups) {
    if (g.items.length < threshold || alreadyProposed(g.label)) continue;
    const failures = g.items.filter((i) => i.run.ok === false).length;
    const proposal = await stageProposal({
      kind: 'skill',
      title: g.label,
      rationale:
        `${g.items.length} runs have asked for this kind of work and all routed to the generic ` +
        `outcome/answer, which has no playbook for it` +
        (failures ? `; ${failures} did not complete` : '') +
        `. Requests: ${unique(g.items.map((i) => i.text)).slice(0, 4).map((t) => `"${t.slice(0, 80)}"`).join(' · ')}.`,
      content: skillDraft(g.label, unique(g.items.map((i) => i.text))),
      evidence: g.items.map((i) => `${i.run.runId ?? 'unknown'}: ${oneLine(i.text)}`).slice(0, 12),
    });
    out.push({ kind: 'skill', title: g.label, occurrences: g.items.length, proposalId: proposal.id });
  }

  // --- a tool that keeps failing the same way is a defect, not bad luck ---
  //
  // The agent cannot fix a tool: ADR-0006 keeps tool code in human hands, and that is the
  // right call. But until this existed it could not even *report* one — it would hit the
  // same failure every run, recover within the run, and leave nothing behind. Four
  // consecutive runs fought the same browser_act locator bug and the fifth started fresh.
  // This is self-healing in the only form the architecture permits: notice, gather the
  // evidence, and put it in front of someone who can change the code.
  const failures = runs.flatMap((r) =>
    (r.observations ?? [])
      .filter((o) => {
        if (o.ok) return false;
        // A denial is the system working. A rule that fired is not a broken tool.
        if (o.ruleId || o.errorCode === 'APPROVAL_DENIED') return false;
        // The distinction that stops this crying wolf: the executor sets `ok: false` both
        // when a handler *reports* a negative finding (`failed: true`, no errorCode) and
        // when one *malfunctions* (a thrown error, which carries a code). check_consistency
        // returning FAIL is the gate doing its job; run_command exiting non-zero is the
        // command's news, not the tool's. Only a thrown error is evidence of a defect.
        // [Without this it re-staged the same three reports every run, 2026-08-14.]
        return Boolean(o.errorCode);
      })
      .map((o) => ({ text: `${o.tool}: ${normaliseError(o.summary ?? o.errorCode ?? '')}`, run: r })),
  );
  for (const g of group(failures)) {
    if (g.items.length < threshold || alreadyProposed(g.label)) continue;
    const tool = g.label.split(':')[0]?.trim() ?? 'a tool';
    const proposal = await stageProposal({
      kind: 'tool',
      title: `${tool} keeps failing the same way`,
      rationale:
        `${tool} has failed ${g.items.length} times across ${new Set(g.items.map((i) => i.run.runId)).size} ` +
        `run(s) with the same error. This is not a denial — no rule fired — so either the tool is ` +
        `defective or its description is misleading enough that the model keeps misusing it. ` +
        `Recovering inside each run costs steps and money every single time.`,
      content: failureReport(tool, g.items.map((i) => ({ text: i.text, runId: i.run.runId }))),
      evidence: g.items.map((i) => `${i.run.runId ?? 'unknown'}: ${oneLine(i.text)}`).slice(0, 12),
    });
    out.push({ kind: 'tool', title: proposal.title, occurrences: g.items.length, proposalId: proposal.id });
  }

  if (out.length) {
    logger.info('mine.staged', { proposals: out.map((p) => `${p.kind}:${p.title}`) });
  }
  return out;
}

/** Strips the variable parts so the same failure groups even with different arguments. */
function normaliseError(text: string): string {
  return oneLine(text)
    .replace(/"[^"]*"/g, '"…"')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b\d+\b/g, 'N')
    .slice(0, 160);
}

/** What a human needs to decide whether the tool or its description is at fault. */
function failureReport(tool: string, items: Array<{ text: string; runId?: string }>): string {
  return [
    `# ${tool} is failing repeatedly`,
    '',
    'This is a **defect report**, not a request for a new tool. Nothing here changes until a',
    'person looks at the handler.',
    '',
    '## What happened',
    '',
    ...items.slice(0, 10).map((i) => `- \`${i.runId ?? 'unknown'}\` — ${i.text}`),
    '',
    '## Two things it could be',
    '',
    `1. **The tool is broken.** Reproduce the call above against \`${tool}\`'s handler.`,
    '2. **The description is misleading.** If the model keeps passing the wrong shape of',
    '   argument, the schema or the description is inviting it — fix the wording, not the model.',
    '',
    '## Before closing this',
    '',
    '- Add a test that fails the way these runs did, so it cannot come back quietly.',
    '- If it was the description, say so here: the next occurrence will re-stage this.',
  ].join('\n');
}

async function recentRuns(slug: string): Promise<RunRecord[]> {
  const dir = path.join(workspaceDir(slug), 'runs');
  const entries = await listRunDirs(dir);
  const out: RunRecord[] = [];
  for (const runPath of entries.slice(-WINDOW)) {
    const rec = await readJson<RunRecord | null>(path.join(runPath, 'run.json'), null);
    if (rec?.runId) out.push(rec);
  }
  return out;
}

async function listRunDirs(dir: string): Promise<string[]> {
  const fsp = await import('node:fs/promises');
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

interface Item {
  text: string;
  run: RunRecord;
}
interface Group {
  label: string;
  items: Item[];
}

/**
 * Single-pass greedy grouping by token overlap. Not clustering — this only needs to notice
 * that "sum incident durations by service" and "total downtime per service" are the same
 * request wearing different words, and a threshold on Jaccard does that well enough.
 */
function group(items: Item[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const t = tokens(item.text);
    if (t.size === 0) continue;
    const hit = groups.find((g) => similar(tokens(g.label), t) >= SIMILARITY);
    if (hit) hit.items.push(item);
    else groups.push({ label: item.text.trim(), items: [item] });
  }
  return groups;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'from', 'by', 'with', 'this',
  'that', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'me', 'my', 'you', 'your', 'what',
  'which', 'how', 'give', 'show', 'tell', 'get', 'please', 'all', 'any', 'each', 'per',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function similar(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / Math.min(a.size, b.size);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()))];
}

/**
 * A tool proposal is a contract, not an implementation. ADR-0006: promoting one prints the
 * contract for a human to implement — a tool never promotes itself at any autonomy level.
 */
function toolContract(label: string, descriptors: string[]): string {
  const name = slugify(label);
  return [
    `# Proposed tool: ${name}`,
    '',
    `## What it would do`,
    '',
    label,
    '',
    '## Evidence',
    '',
    ...unique(descriptors).map((d) => `- written by hand in the sandbox as: ${d}`),
    '',
    '## Suggested contract',
    '',
    '```json',
    JSON.stringify(
      {
        name,
        description: label,
        parameters: { type: 'object', properties: {}, required: [] },
        mutating: false,
        network: false,
        minProfile: 'read-only',
      },
      null,
      2,
    ),
    '```',
    '',
    '## Before promoting',
    '',
    '- Fill in the parameters from what the sandbox code actually took as input.',
    '- Decide the gates. A tool gets a schema and an allowlist entry; sandbox code gets neither.',
    '- A human writes the handler. Promotion prints this contract; it does not create a tool.',
  ].join('\n');
}

/** A skill proposal is a real skill document, so promotion can be a file copy. */
function skillDraft(label: string, examples: string[]): string {
  const id = `outcome/${slugify(label)}`;
  // Without triggers the promoted skill is unreachable: routing only selects an outcome
  // that declares what it matches. These come from the words the recurring requests
  // actually shared, which is the best available evidence of what this work is called.
  const triggers = sharedVocabulary(examples).slice(0, 6);
  return [
    '---',
    `id: ${id}`,
    'kind: outcome',
    'version: 1',
    `description: ${oneLine(label)}`,
    ...(triggers.length >= 2 ? ['triggers:', ...triggers.map((t) => `  - ${t}`)] : []),
    'tools:',
    '  - list_dir',
    '  - read_file',
    '  - search_files',
    '  - search_documents',
    '  - derive_metric',
    '  - sandbox_run',
    '  - check_consistency',
    '  - recall_memory',
    'step_budget: 16',
    'deterministic_seed: false',
    'stages:',
    '  - intake',
    '  - discover',
    '  - act',
    '  - verify',
    '  - deliver',
    'review: guardian',
    '---',
    '',
    `# ${oneLine(label)}`,
    '',
    'Staged automatically because this kind of request recurred and routed to the generic',
    'answer playbook each time. **Read it before promoting** — the steps below are a',
    'skeleton derived from what was asked, not from what worked.',
    '',
    '## When this applies',
    '',
    ...examples.slice(0, 5).map((e) => `- ${oneLine(e)}`),
    '',
    '## Steps',
    '',
    '1. Establish the shape of the source data before reading all of it — one file, then the rest.',
    '2. Extract with a tool rather than by eye, so every figure lands in an artifact.',
    '3. Compute totals and comparisons in the sandbox or with derive_metric, never in prose.',
    '4. Report the result with each specific traced to the artifact it came from.',
    '',
    '## What good looks like',
    '',
    '- Every number in the answer reconciles against an artifact.',
    '- The method is stated, so the next run does it the same way.',
    '',
    '## Open questions for the reviewer',
    '',
    '- Are the steps above actually what the successful runs did?',
    '- Does this deserve its own step budget or review pass?',
  ].join('\n');
}

/**
 * Words common to most of the recurring requests. Requires presence in more than half of
 * them, so one verbose request cannot contribute vocabulary the others never used.
 */
function sharedVocabulary(examples: string[]): string[] {
  if (examples.length === 0) return [];
  const counts = new Map<string, number>();
  for (const e of examples) {
    for (const t of tokens(e)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const needed = Math.ceil(examples.length / 2);
  return [...counts.entries()]
    .filter(([, n]) => n >= needed)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 5)
      .join('-') || 'unnamed'
  );
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}
