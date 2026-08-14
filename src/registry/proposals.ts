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
      if (p) out.push(p);
    }
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || b.updatedAt.localeCompare(a.updatedAt));
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
  opts: { root?: string } = {},
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
      return { proposal, written: proposal.patch.file };
    }

    await setProposalStatus(id, 'promoted', root);
    return {
      proposal,
      manual:
        'Tool proposals require a typed handler in src/tools/builtin/ plus a ToolSpec entry. The proposal body describes the contract; a human writes the code and the gates.',
    };
  }

  const { parseSkill, parseRule } = await import('./loader.js');
  const dir = proposal.kind === 'skill' ? 'skills' : 'rules';
  // Parse before writing: a malformed proposal must fail promotion, not the next run.
  const parsed =
    proposal.kind === 'skill'
      ? parseSkill(proposal.content, `proposal:${id}`)
      : parseRule(proposal.content, `proposal:${id}`);

  const live = path.join(root, dir, `${slugify(parsed.id)}.md`);
  const currentVersion = (await exists(live)) ? await readVersion(live, proposal.kind) : 0;
  const nextVersion = Math.max(currentVersion + 1, parsed.version);
  const content = setVersionInFrontmatter(proposal.content, nextVersion);

  const versionFile = path.join(root, 'versions', dir, slugify(parsed.id), `v${nextVersion}.md`);
  await ensureDir(path.dirname(versionFile));
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

export function slugify(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
