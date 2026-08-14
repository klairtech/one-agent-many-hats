/**
 * Standing grants (ADR-0009): scoped, expiring, revocable permission for unattended work.
 *
 * The design rule throughout: **an unmatched constraint denies.** A grant that names
 * `run_command` but says nothing about which commands does not authorise every command —
 * it authorises none, and `createGrant` refuses to create it. Defaulting open here would
 * quietly reproduce the blunt `allowTools` this exists to replace.
 *
 * Nothing the model can call reaches this file. Grants are created by a human at the CLI
 * or in the panel, and that is the whole point of them.
 */

import path from 'node:path';
import { unlink } from 'node:fs/promises';

import { HatsError } from '../core/errors.js';
import { grantsDir } from '../core/paths.js';
import { ensureDir, exists, listFiles, readJson, shortHash, writeJsonAtomic } from '../core/store.js';

/** Which scope key each tool is constrained by. A tool absent here cannot be granted. */
const SCOPE_FOR: Record<string, keyof GrantScope> = {
  write_file: 'paths',
  apply_patch: 'paths',
  run_command: 'commands',
  ssh_run: 'hosts',
  browser_act: 'hosts',
  send_email: 'recipients',
  fetch_url: 'hosts',
  transcribe_audio: 'paths',
};

export interface GrantScope {
  /** Glob patterns, relative to the workspace root. */
  paths?: string[];
  /** Hostnames. A leading dot means "and its subdomains". */
  hosts?: string[];
  /** Command prefixes or globs, matched against the whole command line. */
  commands?: string[];
  /** Exact email addresses. No wildcards: the agent must not invent a recipient. */
  recipients?: string[];
}

export interface Grant {
  id: string;
  tools: string[];
  scope: GrantScope;
  /** Why a person granted this, in their words. Shown when it is used and when listed. */
  reason: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  maxUses?: number;
  used: number;
  revoked?: boolean;
  /** Confine to one workspace. Absent means any workspace on this machine. */
  workspace?: string;
}

export interface GrantCheck {
  allowed: boolean;
  grant?: Grant;
  /** Why, in a sentence, for the audit trail and for the human reading it later. */
  reason: string;
}

export interface NewGrant {
  tools: string[];
  scope?: GrantScope;
  reason: string;
  createdBy?: string;
  expiresAt?: string;
  maxUses?: number;
  workspace?: string;
}

export async function createGrant(input: NewGrant): Promise<Grant> {
  const tools = [...new Set(input.tools.map((t) => t.trim()).filter(Boolean))];
  if (tools.length === 0) throw new HatsError('CONFIG_INVALID', 'a grant must name a tool', {});
  if (!input.reason?.trim()) {
    // Not bureaucracy: a grant with no stated reason cannot be reviewed later, and an
    // unreviewable standing permission is the thing this design exists to avoid.
    throw new HatsError('CONFIG_INVALID', 'a grant needs a reason — it is read when revoking', {});
  }

  const scope = input.scope ?? {};
  for (const tool of tools) {
    const key = SCOPE_FOR[tool];
    if (!key) {
      throw new HatsError(
        'CONFIG_INVALID',
        `"${tool}" cannot be granted: only tools with a defined scope can be, and this one has none`,
        { grantable: Object.keys(SCOPE_FOR) },
      );
    }
    if (!scope[key] || scope[key]?.length === 0) {
      throw new HatsError(
        'CONFIG_INVALID',
        `granting "${tool}" requires a ${key} scope — an unscoped grant authorises everything ` +
          `that tool can do, which is what this replaces`,
        { tool, needs: key },
      );
    }
  }
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
    throw new HatsError('CONFIG_INVALID', `"${input.expiresAt}" is not a date`, {});
  }
  if (input.maxUses !== undefined && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) {
    throw new HatsError('CONFIG_INVALID', 'maxUses must be a whole number above zero', {});
  }

  const grant: Grant = {
    id: `grn_${shortHash(`${tools.join(',')}${input.reason}${Date.now()}`)}`,
    tools,
    scope,
    reason: input.reason.trim(),
    createdBy: input.createdBy ?? localActor(),
    createdAt: new Date().toISOString(),
    used: 0,
    ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt).toISOString() } : {}),
    ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {}),
  };
  await saveGrant(grant);
  return grant;
}

export async function saveGrant(grant: Grant): Promise<void> {
  const dir = await ensureDir(grantsDir());
  await writeJsonAtomic(path.join(dir, `${grant.id}.json`), grant);
}

export async function listGrants(): Promise<Grant[]> {
  const dir = grantsDir();
  if (!(await exists(dir))) return [];
  const out: Grant[] = [];
  for (const file of await listFiles(dir, '.json')) {
    const g = await readJson<Grant | null>(file, null);
    if (g?.id) out.push(g);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getGrant(id: string): Promise<Grant> {
  const all = await listGrants();
  const hits = all.filter((g) => g.id === id || g.id.startsWith(id));
  if (hits.length === 0) {
    throw new HatsError('REGISTRY_NOT_FOUND', `no grant "${id}"`, { known: all.map((g) => g.id) });
  }
  if (hits.length > 1) {
    throw new HatsError('CONFIG_INVALID', `"${id}" matches ${hits.length} grants`, {
      matches: hits.map((g) => g.id),
    });
  }
  return hits[0] as Grant;
}

export async function revokeGrant(id: string): Promise<Grant> {
  const g = await getGrant(id);
  // Marked rather than deleted: the record of what was permitted, and when it stopped, is
  // the part that matters afterwards.
  const revoked = { ...g, revoked: true };
  await saveGrant(revoked);
  return revoked;
}

export async function deleteGrant(id: string): Promise<Grant> {
  const g = await getGrant(id);
  await unlink(path.join(grantsDir(), `${g.id}.json`));
  return g;
}

export function grantStatus(g: Grant, now = new Date()): 'active' | 'revoked' | 'expired' | 'spent' {
  if (g.revoked) return 'revoked';
  if (g.expiresAt && new Date(g.expiresAt) <= now) return 'expired';
  if (g.maxUses !== undefined && g.used >= g.maxUses) return 'spent';
  return 'active';
}

/**
 * Does any grant authorise this call?
 *
 * Called from the unattended approver only. Returns the matching grant so the caller can
 * consume a use — consumption is deliberately separate, so a check that is never acted on
 * does not burn the budget.
 */
export async function checkGrants(
  tool: string,
  args: Record<string, unknown>,
  workspace: string,
  now = new Date(),
): Promise<GrantCheck> {
  const grants = await listGrants();
  const candidates = grants.filter((g) => g.tools.includes(tool));
  if (candidates.length === 0) {
    return { allowed: false, reason: `no standing grant covers ${tool}` };
  }

  let lastReason = `no standing grant covers ${tool}`;
  for (const g of candidates) {
    const status = grantStatus(g, now);
    if (status !== 'active') {
      lastReason = `grant ${g.id} for ${tool} is ${status}`;
      continue;
    }
    if (g.workspace && path.resolve(g.workspace) !== path.resolve(workspace)) {
      lastReason = `grant ${g.id} is for another workspace`;
      continue;
    }
    const scoped = withinScope(tool, args, g.scope);
    if (!scoped.ok) {
      lastReason = `grant ${g.id} covers ${tool} but not this call: ${scoped.why}`;
      continue;
    }
    return {
      allowed: true,
      grant: g,
      reason: `grant ${g.id} (${g.reason})${g.maxUses ? ` — use ${g.used + 1} of ${g.maxUses}` : ''}`,
    };
  }
  return { allowed: false, reason: lastReason };
}

/** Records that a grant was used. Persisted, so maxUses survives a restart. */
export async function consumeGrant(grant: Grant): Promise<void> {
  const fresh = await getGrant(grant.id).catch(() => grant);
  await saveGrant({ ...fresh, used: (fresh.used ?? 0) + 1 });
}

function withinScope(
  tool: string,
  args: Record<string, unknown>,
  scope: GrantScope,
): { ok: boolean; why: string } {
  const key = SCOPE_FOR[tool];
  if (!key) return { ok: false, why: `${tool} has no scope definition` };
  const patterns = scope[key] ?? [];
  if (patterns.length === 0) return { ok: false, why: `the grant declares no ${key}` };

  if (key === 'recipients') {
    const to = recipientsOf(args);
    if (to.length === 0) return { ok: false, why: 'no recipient on the call' };
    const allowed = patterns.map((p) => p.toLowerCase().trim());
    // Exact match only. A wildcard recipient would let the agent choose who to write to,
    // which is the decision the human is supposed to be making.
    const bad = to.filter((r) => !allowed.includes(r.toLowerCase()));
    return bad.length
      ? { ok: false, why: `not an allowed recipient: ${bad.join(', ')}` }
      : { ok: true, why: '' };
  }

  if (key === 'hosts') {
    const host = hostOf(args);
    if (!host) return { ok: false, why: 'no host on the call' };
    const ok = patterns.some((p) => hostMatches(host, p));
    return ok ? { ok: true, why: '' } : { ok: false, why: `host ${host} is not in scope` };
  }

  if (key === 'commands') {
    const cmd = String(args['command'] ?? '').trim();
    if (!cmd) return { ok: false, why: 'no command on the call' };
    const ok = patterns.some((p) => globMatches(cmd, p));
    return ok ? { ok: true, why: '' } : { ok: false, why: `command is not in scope: ${cmd}` };
  }

  // paths
  const targets = pathsOf(args);
  if (targets.length === 0) return { ok: false, why: 'no path on the call' };
  const bad = targets.filter((t) => !patterns.some((p) => globMatches(normalise(t), p)));
  return bad.length
    ? { ok: false, why: `path not in scope: ${bad.join(', ')}` }
    : { ok: true, why: '' };
}

function recipientsOf(args: Record<string, unknown>): string[] {
  const raw = args['to'];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function hostOf(args: Record<string, unknown>): string | null {
  const host = args['host'];
  if (typeof host === 'string' && host.trim()) return host.trim().toLowerCase();
  const url = args['url'];
  if (typeof url === 'string') {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

function pathsOf(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ['path', 'file', 'target']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  return out;
}

function normalise(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/');
}

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase().trim();
  if (p.startsWith('.')) return host === p.slice(1) || host.endsWith(p);
  return host === p;
}

/**
 * Glob with `*` (within a segment) and `**` (across segments). Written rather than
 * depended on, and deliberately anchored at both ends — an unanchored match would make
 * `reports/**` accept `../../etc/reports/x`.
 */
export function globMatches(value: string, pattern: string): boolean {
  const p = pattern.trim();
  if (p === '*' || p === '**') return true;
  const rx = p
    .split('')
    .map((ch, i, arr) => {
      if (ch === '*') {
        if (arr[i - 1] === '*') return '';
        if (arr[i + 1] === '*') return '.*';
        return '[^/]*';
      }
      if (ch === '?') return '[^/]';
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${rx}$`).test(value);
}

/** True when a scope would authorise essentially anything, so callers can warn. */
export function isWideOpen(scope: GrantScope): boolean {
  return Object.values(scope).some((patterns: string[] | undefined) =>
    (patterns ?? []).some((p: string) => p.trim() === '*' || p.trim() === '**'),
  );
}

function localActor(): string {
  return process.env['USER'] ?? process.env['USERNAME'] ?? 'local user';
}
