/**
 * Disk usage, and getting some of it back.
 *
 * The framing that matters: every category here is described by **what deleting it costs**,
 * not only by what it frees. Run records are the biggest thing on disk and also the thing
 * the whole architecture rests on — "which step introduced this claim" is only answerable
 * while the trail exists. A storage screen that shows megabytes and hides that is a screen
 * that talks people into deleting their audit trail.
 *
 * So: artifacts can go without losing the trail, the index rebuilds itself, the cache is
 * free to drop, and memory and run records are marked as losses rather than savings.
 *
 * Safety: every path is resolved and checked to be inside $HATS_HOME before anything is
 * removed. `config.json` and `credentials.json` are never touched by any operation here.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from './errors.js';
import { hatsHome, workspaceDir } from './paths.js';
import { exists, readJson } from './store.js';

export type Reversibility = 'free' | 'rebuildable' | 'lossy' | 'permanent';

export interface SpaceEntry {
  key: string;
  label: string;
  bytes: number;
  items: number;
  /** What you lose. Written for a human deciding, not for a changelog. */
  cost: string;
  reversibility: Reversibility;
  /** Present for workspace-scoped entries. */
  workspace?: string;
}

export interface WorkspaceSpace {
  slug: string;
  root: string | null;
  /** True when the directory this workspace refers to no longer exists. */
  orphaned: boolean;
  bytes: number;
  runs: number;
  entries: SpaceEntry[];
  lastRunAt: string | null;
}

export interface SpaceReport {
  home: string;
  totalBytes: number;
  global: SpaceEntry[];
  workspaces: WorkspaceSpace[];
}

export async function scanSpace(): Promise<SpaceReport> {
  const home = hatsHome();
  const global: SpaceEntry[] = [];

  global.push({
    key: 'cache',
    label: 'Provider catalogue cache',
    ...(await measure(path.join(home, 'cache'))),
    cost: 'Nothing. Model lists and prices are re-fetched when next needed.',
    reversibility: 'free',
  });
  global.push({
    key: 'registry-versions',
    label: 'Registry version history',
    ...(await measure(path.join(home, 'registry', 'versions'))),
    cost: 'The previous versions of every promoted skill and rule. You lose the ability to see what a change actually changed.',
    reversibility: 'permanent',
  });
  global.push({
    key: 'registry-archive',
    label: 'Archived skills and rules',
    ...(await measure(path.join(home, 'registry', 'archive'))),
    cost: 'Entries you retired earlier. Gone for good.',
    reversibility: 'permanent',
  });

  const workspaces: WorkspaceSpace[] = [];
  const wsRoot = path.join(home, 'workspaces');
  for (const slug of await listDirs(wsRoot)) {
    const dir = path.join(wsRoot, slug);
    const root = await readWorkspaceRoot(dir);
    const runsDir = path.join(dir, 'runs');
    const runIds = await listDirs(runsDir);

    let artifactBytes = 0;
    let artifactItems = 0;
    let recordBytes = 0;
    for (const id of runIds) {
      const a = await measure(path.join(runsDir, id, 'artifacts'));
      artifactBytes += a.bytes;
      artifactItems += a.items;
      const whole = await measure(path.join(runsDir, id));
      recordBytes += whole.bytes - a.bytes;
    }

    const entries: SpaceEntry[] = [
      {
        key: 'artifacts',
        label: 'Run artifacts',
        bytes: artifactBytes,
        items: artifactItems,
        cost:
          'The full payloads behind past answers — the file contents, the fetched pages, the computed tables. The runs, their steps and their audit trails all survive; you just cannot re-open the evidence a past answer cited.',
        reversibility: 'lossy',
        workspace: slug,
      },
      {
        key: 'runs',
        label: 'Run records and audit trails',
        bytes: recordBytes,
        items: runIds.length,
        cost:
          'Every record of what this agent did and why — the steps, the tool calls, the gate decisions, which skill version was loaded. This is the trail that makes a wrong answer diagnosable.',
        reversibility: 'permanent',
        workspace: slug,
      },
      {
        key: 'index',
        label: 'Document index',
        ...(await measure(path.join(dir, 'index'))),
        cost: 'Nothing permanent. Rebuild it with `hats index`, though re-embedding takes a minute.',
        reversibility: 'rebuildable',
        workspace: slug,
      },
      {
        key: 'memory',
        label: 'Memory: lessons, takeaways, persona',
        ...(await measure(path.join(dir, 'memory'))),
        cost:
          'Everything it has learned here. Corrections you gave it, lessons it distilled, what it noticed about how you work. Your authored workspace context survives — it lives outside this folder.',
        reversibility: 'permanent',
        workspace: slug,
      },
    ];

    const total = (await measure(dir)).bytes;
    workspaces.push({
      slug,
      root,
      orphaned: root !== null && !(await exists(root)),
      bytes: total,
      runs: runIds.length,
      entries,
      lastRunAt: runIds.length > 0 ? (runIds.sort().at(-1) ?? null) : null,
    });
  }

  workspaces.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = (await measure(home)).bytes;
  return { home, totalBytes, global, workspaces };
}

export interface PruneRequest {
  /** cache | registry-versions | registry-archive | artifacts | runs | index | memory | workspace */
  target: string;
  workspace?: string;
  /** For `runs`: keep this many most recent, delete the rest. */
  keepLast?: number;
  /** For `runs`: delete anything older than this many days. */
  olderThanDays?: number;
  /** Report what would go without removing it. */
  dryRun?: boolean;
}

export interface PruneResult {
  target: string;
  workspace?: string;
  bytesFreed: number;
  itemsRemoved: number;
  paths: string[];
  dryRun: boolean;
}

export async function prune(request: PruneRequest): Promise<PruneResult> {
  const home = hatsHome();
  const dryRun = request.dryRun === true;
  const targets: string[] = [];

  switch (request.target) {
    case 'cache':
      targets.push(path.join(home, 'cache'));
      break;
    case 'registry-versions':
      targets.push(path.join(home, 'registry', 'versions'));
      break;
    case 'registry-archive':
      targets.push(path.join(home, 'registry', 'archive'));
      break;
    case 'index':
      targets.push(path.join(requireWorkspace(request), 'index'));
      break;
    case 'memory':
      targets.push(path.join(requireWorkspace(request), 'memory'));
      break;
    case 'workspace':
      targets.push(requireWorkspace(request));
      break;
    case 'artifacts': {
      const runsDir = path.join(requireWorkspace(request), 'runs');
      for (const id of await listDirs(runsDir)) targets.push(path.join(runsDir, id, 'artifacts'));
      break;
    }
    case 'runs': {
      const runsDir = path.join(requireWorkspace(request), 'runs');
      const ids = (await listDirs(runsDir)).sort();
      const cutoff = request.olderThanDays
        ? Date.now() - request.olderThanDays * 86_400_000
        : null;
      const keep = new Set(request.keepLast ? ids.slice(-request.keepLast) : []);
      for (const id of ids) {
        if (keep.has(id)) continue;
        if (cutoff !== null && runIdTime(id) !== null && (runIdTime(id) as number) >= cutoff) continue;
        targets.push(path.join(runsDir, id));
      }
      break;
    }
    default:
      throw new HatsError('TOOL_INPUT_INVALID', `unknown prune target "${request.target}"`, {});
  }

  let bytesFreed = 0;
  let itemsRemoved = 0;
  const removed: string[] = [];

  for (const target of targets) {
    const safe = assertInsideHome(target, home);
    if (!(await exists(safe))) continue;
    const size = await measure(safe);
    bytesFreed += size.bytes;
    itemsRemoved += size.items;
    removed.push(path.relative(home, safe));
    if (!dryRun) await fsp.rm(safe, { recursive: true, force: true });
  }

  return {
    target: request.target,
    ...(request.workspace ? { workspace: request.workspace } : {}),
    bytesFreed,
    itemsRemoved,
    paths: removed,
    dryRun,
  };
}

function requireWorkspace(request: PruneRequest): string {
  if (!request.workspace) {
    throw new HatsError('TOOL_INPUT_INVALID', `target "${request.target}" needs a workspace`, {});
  }
  return workspaceDir(request.workspace);
}

/**
 * Nothing outside $HATS_HOME is ever removed, and the two files that would be painful to
 * lose are excluded by name regardless of what a caller asks for.
 */
function assertInsideHome(candidate: string, home: string): string {
  const resolved = path.resolve(candidate);
  const root = path.resolve(home);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new HatsError('SCOPE_DENIED', `refusing to delete outside ${root}`, { candidate }, 'rule/workspace-scope');
  }
  if (resolved === root) {
    throw new HatsError('SCOPE_DENIED', 'refusing to delete the whole hats home', { candidate });
  }
  const base = path.basename(resolved);
  if (base === 'config.json' || base === 'credentials.json') {
    throw new HatsError('SCOPE_DENIED', `${base} is never removed by pruning`, { candidate });
  }
  return resolved;
}

/** Run ids start with an ISO-ish stamp: 20260814T130508Z-843a35. */
export function runIdTime(id: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(id);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

async function measure(dir: string): Promise<{ bytes: number; items: number }> {
  let bytes = 0;
  let items = 0;
  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      const stat = await fsp.stat(full).catch(() => null);
      if (!stat) continue;
      bytes += stat.size;
      items++;
    }
  }
  return { bytes, items };
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function readWorkspaceRoot(dir: string): Promise<string | null> {
  try {
    return (await fsp.readFile(path.join(dir, 'WORKSPACE'), 'utf8')).trim() || null;
  } catch {
    // Older workspaces have no stamp; fall back to the run record if there is one.
    const runs = path.join(dir, 'runs');
    const ids = (await listDirs(runs)).sort();
    const last = ids.at(-1);
    if (!last) return null;
    const record = await readJson<{ workspace?: { root?: string } } | null>(
      path.join(runs, last, 'run.json'),
      null,
    );
    return record?.workspace?.root ?? null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
