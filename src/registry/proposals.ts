/**
 * Self-extension, the staged half (paper §4).
 *
 * The agent may write here. It may not write anywhere else in the registry. Promotion is
 * a human CLI action, and it is the only path from `proposals/` to live — which is what
 * makes "a system that grows with use" different from "a system that rewrites itself".
 */

import path from 'node:path';

import { HatsError } from '../core/errors.js';
import { registryDir } from '../core/paths.js';
import {
  ensureDir,
  exists,
  listFiles,
  readJson,
  shortHash,
  utcStamp,
  writeJsonAtomic,
  writeTextAtomic,
} from '../core/store.js';
import fsp from 'node:fs/promises';

export type ProposalKind = 'skill' | 'rule' | 'tool';
export type ProposalStatus = 'draft' | 'promoted' | 'rejected';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  /** Why the system thinks this should exist — evidence, not opinion. */
  rationale: string;
  /** Run ids and task descriptors that motivated it (paper §4: repeated clusters). */
  evidence: string[];
  /** The proposed document (skill/rule markdown) or tool sketch. */
  content: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  createdByRun?: string;
  occurrences: number;
  /** ADR-0010: set when this proposal is a code fix rather than a new capability. */
  patch?: import('./patches.js').Patch;
  /**
   * ADR-0011: set when the agent wrote a working tool rather than a description of one.
   * Promotion installs this; without it a tool proposal is still a contract for a person.
   */
  implementation?: {
    tool: import('../tools/generated/store.js').GeneratedTool;
    code: string;
    /** Which home it was built for. Absent means the device, which is what it always was. */
    scope?: 'device' | 'workspace';
  };
  /**
   * Why auto-promotion left this alone, in the words it used at the time.
   *
   * It was computed and logged and nowhere else, so on the page a blocked proposal was
   * indistinguishable from one nobody had got to yet — which reads as the feature quietly
   * not working rather than as a decision with a reason.
   */
  blockedBecause?: { reason: string; at: string };
  /**
   * A tool that keeps failing the same way. Carries the tool's name so the panel can offer
   * a repair rather than leaving a report nobody is going to action.
   */
  defect?: { tool: string };
  /**
   * When a repair run was last started from this defect, and which run it was.
   *
   * A defect report is a request for work, and the moment somebody presses Repair it stops
   * being one — but nothing recorded that, so it sat in "Ready to apply" demanding a
   * decision that had already been made, and the miner kept re-staging it. Recorded rather
   * than deleted: an attempt that produced nothing is worth seeing, and worth retrying.
   */
  repairStartedAt?: string;
  repairRunId?: string;
  /**
   * ADR-0011: the author asked for this to live only as long as the conversation.
   *
   * The implementation is still recorded, so a person can adopt it later with
   * `hats promote`, but nothing installs it on their behalf. Without this the
   * conversation-only path was a lie by omission: the tool was staged like any other and
   * auto-promotion installed it seconds after the run said "nothing was installed anywhere".
   */
  ephemeral?: boolean;
  /**
   * The playbook id this claims to replace, when the agent said so. Recorded for the record
   * and the panel — never used to decide anything, because `isRevision` can establish the
   * same fact from the registry and does not depend on the model remembering to declare it.
   */
  revises?: string;
}

export function proposalsDir(kind: ProposalKind, root = registryDir()): string {
  return path.join(root, 'proposals', `${kind}s`);
}

function proposalPath(kind: ProposalKind, id: string, root = registryDir()): string {
  return path.join(proposalsDir(kind, root), `${id}.json`);
}

/**
 * Stages a proposal. Repeats do not pile up: a proposal whose title hashes to an existing
 * draft increments `occurrences` instead, which is exactly the "repeated clusters are
 * evidence" signal a reviewer needs to prioritise.
 */
export async function stageProposal(
  input: Omit<Proposal, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'occurrences'>,
  root = registryDir(),
): Promise<Proposal> {
  const id = `${input.kind}-${shortHash(input.title.toLowerCase().trim())}`;
  const file = proposalPath(input.kind, id, root);
  await ensureDir(path.dirname(file));

  const existing = await readJson<Proposal | null>(file, null);
  const now = utcStamp();
  if (existing && existing.status === 'draft') {
    const merged: Proposal = {
      ...existing,
      occurrences: existing.occurrences + 1,
      evidence: [...new Set([...existing.evidence, ...input.evidence])].slice(0, 50),
      rationale: input.rationale || existing.rationale,
      // A second attempt at the same tool is usually a *fix* to the first one. Keeping the
      // original would mean the agent corrects a handler, sees "seen 2 times now", and the
      // broken version is what eventually installs.
      ...(input.implementation ? { implementation: input.implementation } : {}),
      updatedAt: now,
    };
    await writeJsonAtomic(file, merged);
    return merged;
  }

  const proposal: Proposal = {
    ...input,
    id,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    occurrences: 1,
  };
  await writeJsonAtomic(file, proposal);
  return proposal;
}

export async function listProposals(root = registryDir()): Promise<Proposal[]> {
  const out: Proposal[] = [];
  for (const kind of ['skill', 'rule', 'tool'] as const) {
    for (const file of await listFiles(proposalsDir(kind, root), '.json')) {
      const p = await readJson<Proposal | null>(file, null);
      if (p) out.push(withInferredDefect(p));
    }
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * A defect report staged before defects carried the tool's name still describes one.
 *
 * Inferred from the title rather than migrated on disk: a report that has been sitting
 * there for weeks is exactly the one worth being able to act on, and rewriting every old
 * proposal to add a field is a bigger promise than reading it back.
 */
function withInferredDefect(p: Proposal): Proposal {
  if (p.kind !== 'tool' || p.defect) return p;
  const named = /^([a-z][a-z0-9_]*) keeps failing the same way$/.exec(p.title.trim());
  return named ? { ...p, defect: { tool: named[1] as string } } : p;
}

export async function getProposal(id: string, root = registryDir()): Promise<Proposal> {
  const all = await listProposals(root);
  const found = all.find((p) => p.id === id);
  if (!found) {
    throw new HatsError('REGISTRY_NOT_FOUND', `no proposal "${id}"`, {
      known: all.map((p) => p.id),
    });
  }
  return found;
}

/**
 * Mark a defect as having had a repair started against it.
 *
 * Deliberately not a status change: the proposal is still a draft, still promotable, and
 * still there to read. What changes is that it no longer asks for a decision nobody needs
 * to make twice.
 */
export async function noteRepairStarted(
  id: string,
  runId: string,
  root = registryDir(),
): Promise<void> {
  const p = await getProposal(id, root).catch(() => null);
  if (!p) return;
  await writeJsonAtomic(proposalPath(p.kind, p.id, root), {
    ...p,
    repairStartedAt: utcStamp(),
    repairRunId: runId,
    updatedAt: utcStamp(),
  });
}

/**
 * Close the defects a promoted patch answers.
 *
 * Matched on the tool's name appearing in the patch's own reason, because that is the one
 * link the two records genuinely share — a patch names a *file*, a defect names a *tool*,
 * and one file holds several tools. The reason is written by the run that read the handler,
 * so if it does not mention the tool it was repairing, leaving the report open is the right
 * outcome anyway.
 */
export async function closeDefectsFixedBy(
  patch: { reason: string },
  root = registryDir(),
): Promise<string[]> {
  const closed: string[] = [];
  for (const p of await listProposals(root)) {
    if (p.status !== 'draft' || !p.defect) continue;
    if (!patch.reason.includes(p.defect.tool)) continue;
    await setProposalStatus(p.id, 'promoted', root);
    closed.push(p.id);
  }
  return closed;
}

/** Records why automation declined, without changing the proposal's status. */
export async function noteBlocked(
  id: string,
  reason: string,
  root = registryDir(),
): Promise<void> {
  const p = await getProposal(id, root).catch(() => null);
  if (!p) return;
  if (p.blockedBecause?.reason === reason) return;
  await writeJsonAtomic(proposalPath(p.kind, p.id, root), {
    ...p,
    blockedBecause: { reason, at: utcStamp() },
  });
}

export async function setProposalStatus(
  id: string,
  status: ProposalStatus,
  root = registryDir(),
): Promise<Proposal> {
  const p = await getProposal(id, root);
  const updated: Proposal = { ...p, status, updatedAt: utcStamp() };
  await writeJsonAtomic(proposalPath(p.kind, p.id, root), updated);
  return updated;
}

/**
 * Human promotion (paper §4). Two ordering rules, both deliberate:
 *  - a tool proposal is never promoted here, because a tool needs a typed handler and
 *    gates that only a developer can write; promoting one prints what to implement.
 *  - the version file is written before the live file, so a crash leaves a spare version
 *    rather than a live entry with no history (ADR-0003).
 */
export async function promoteProposal(
  id: string,
  opts: { root?: string; workspaceRoot?: string } = {},
): Promise<{ proposal: Proposal; written?: string; manual?: string }> {
  const root = opts.root ?? registryDir();
  const proposal = await getProposal(id, root);
  if (proposal.status !== 'draft') {
    throw new HatsError('REGISTRY_IMMUTABLE', `proposal ${id} is already ${proposal.status}`, {});
  }

  if (proposal.kind === 'tool') {
    // ADR-0010: a proposal carrying a patch is a repair, and repairs can be applied — but
    // only after the build and the whole test suite pass. Everything else is still a
    // contract for a person to implement.
    if (proposal.patch) {
      const { applyPatch } = await import('./patches.js');
      const outcome = await applyPatch({ ...proposal.patch, id: proposal.id });
      if (!outcome.applied) {
        // Left as a draft on purpose: a refused patch is evidence, and marking it promoted
        // would hide a defect that is still there.
        throw new HatsError(
          'REGISTRY_IMMUTABLE',
          `patch refused at the ${outcome.stage} check: ${outcome.reason}`,
          { stage: outcome.stage, ...(outcome.detail ? { detail: outcome.detail } : {}) },
        );
      }
      await setProposalStatus(id, 'promoted', root);
      // The report that asked for this is answered now. Leaving it open is how the same
      // defect gets repaired twice.
      const closed = await closeDefectsFixedBy(proposal.patch, root);
      return {
        proposal,
        written: proposal.patch.file + (closed.length ? ` (closed ${closed.length} defect report(s))` : ''),
      };
    }

    // ADR-0011: the proposal carries a working handler, so promotion installs it.
    if (proposal.implementation) {
      const { installGeneratedTool } = await import('../tools/generated/install.js');
      const outcome = await installGeneratedTool(proposal.implementation, opts.workspaceRoot);
      if (!outcome.installed) {
        // Left a draft on purpose, same as a refused patch: a tool that did not install is
        // evidence about the tool, and marking it promoted would hide a thing that is not there.
        throw new HatsError(
          'REGISTRY_IMMUTABLE',
          `the tool did not install at the ${outcome.stage} check: ${outcome.reason}`,
          { stage: outcome.stage },
        );
      }
      await setProposalStatus(id, 'promoted', root);
      return { proposal, written: outcome.dir };
    }

    await setProposalStatus(id, 'promoted', root);
    return {
      proposal,
      manual:
        'This tool proposal describes a contract but carries no handler. Use build_tool to write one, or implement it in src/tools/builtin/ with a ToolSpec entry.',
    };
  }

  const { parseSkill, parseRule } = await import('./loader.js');
  const dir = proposal.kind === 'skill' ? 'skills' : 'rules';
  // Parse before writing: a malformed proposal must fail promotion, not the next run.
  const parsed =
    proposal.kind === 'skill'
      ? parseSkill(proposal.content, `proposal:${id}`)
      : parseRule(proposal.content, `proposal:${id}`);

  // Resolved by the id *inside* each file, not by slugifying the id into a filename. Those
  // two agree for skills by luck — `outcome/answer` slugs to `outcome-answer.md`, which is
  // what it is called — and never for rules: `rule/no-invented-numbers` slugs to
  // `rule-no-invented-numbers.md` while the file shipped as `no-invented-numbers.md`. So a
  // revision of any rule found no existing file, skipped the weakening check, and wrote a
  // second rule with the same id alongside the first.
  const live = (await findLiveFile(root, dir, parsed.id)) ?? path.join(root, dir, `${slugify(parsed.id)}.md`);

  // A revision of a rule may sharpen what it says and may not weaken what it enforces.
  // Nothing else in the pipeline would notice `strength: gate` becoming `strength: prompt`:
  // it parses, it promotes, and the check quietly stops running while the text still reads
  // like a rule.
  if (proposal.kind === 'rule' && (await exists(live))) {
    const { assertRuleRevision } = await import('./revision.js');
    const currentRaw = await fsp.readFile(live, 'utf8');
    assertRuleRevision(parseRule(currentRaw, live), parsed as import('./types.js').Rule);
  }

  const currentVersion = (await exists(live)) ? await readVersion(live, proposal.kind) : 0;
  const nextVersion = Math.max(currentVersion + 1, parsed.version);
  const content = setVersionInFrontmatter(proposal.content, nextVersion);

  const versionFile = path.join(root, 'versions', dir, slugify(parsed.id), `v${nextVersion}.md`);
  await ensureDir(path.dirname(versionFile));

  // Snapshot what is being replaced, if nothing has snapshotted it yet.
  //
  // History only ever recorded versions this code wrote, so a playbook that shipped in the
  // pack and was then revised had exactly one entry — the *new* text. "The previous version
  // is kept, so a bad revision can be reverted" was therefore false for the first revision
  // of every shipped playbook, which is precisely the revision most likely to be wrong.
  if (currentVersion > 0) {
    const previous = path.join(path.dirname(versionFile), `v${currentVersion}.md`);
    if (!(await exists(previous))) {
      await writeTextAtomic(previous, await fsp.readFile(live, 'utf8'));
    }
  }

  await writeTextAtomic(versionFile, content);
  await writeTextAtomic(live, content);
  await setProposalStatus(id, 'promoted', root);
  return { proposal, written: live };
}

/** Deletes are denied (paper §4): archiving keeps history rather than removing it. */
export async function archiveLive(
  kind: 'skill' | 'rule',
  id: string,
  root = registryDir(),
): Promise<string> {
  const dir = kind === 'skill' ? 'skills' : 'rules';
  const live = path.join(root, dir, `${slugify(id)}.md`);
  if (!(await exists(live))) {
    throw new HatsError('REGISTRY_NOT_FOUND', `no live ${kind} "${id}"`, {});
  }
  const archive = path.join(root, 'archive', dir, `${slugify(id)}.${Date.now()}.md`);
  await ensureDir(path.dirname(archive));
  await fsp.rename(live, archive);
  return archive;
}

async function readVersion(file: string, kind: 'skill' | 'rule'): Promise<number> {
  const raw = await fsp.readFile(file, 'utf8');
  const { parseSkill, parseRule } = await import('./loader.js');
  const parsed = kind === 'skill' ? parseSkill(raw, file) : parseRule(raw, file);
  return parsed.version;
}

function setVersionInFrontmatter(content: string, version: number): string {
  if (/^---/.test(content) && /\nversion:\s*\d+/.test(content)) {
    return content.replace(/\nversion:\s*\d+/, `\nversion: ${version}`);
  }
  return content.replace(/^---\n/, `---\nversion: ${version}\n`);
}

/**
 * Is this proposal replacing a playbook that already exists?
 *
 * Answered from the registry rather than from what the proposal claims. A revision is a
 * proposal whose document declares an id that is already live — that is what makes
 * promotion overwrite one file instead of adding another, so it is also the honest
 * definition, whether or not the agent passed `revises`.
 */
export async function isRevision(proposal: Proposal, root = registryDir()): Promise<boolean> {
  if (proposal.kind === 'tool') return false;
  const id = /^id:\s*(.+)$/m.exec(proposal.content)?.[1]?.trim();
  if (!id) return false;
  return (await findLiveFile(root, proposal.kind === 'skill' ? 'skills' : 'rules', id)) !== null;
}

/** The file whose frontmatter declares this id, if one is already live. */
async function findLiveFile(root: string, dir: string, id: string): Promise<string | null> {
  for (const file of await listFiles(path.join(root, dir), '.md')) {
    const raw = await fsp.readFile(file, 'utf8').catch(() => '');
    if (new RegExp(`^id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(raw)) return file;
  }
  return null;
}

export function slugify(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
