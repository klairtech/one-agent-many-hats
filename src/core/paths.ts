/**
 * Path resolution and the scope guard.
 *
 * REPO_RULES §4.3: every path the agent reads or writes resolves inside the active
 * workspace root or $HATS_HOME, and that check happens in exactly one place — PathGuard.
 * Symlinks are resolved before the check, which is the whole reason this is not a
 * `startsWith` one-liner at each call site.
 */

import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HatsError } from './errors.js';

/** Walk up from this module until a package.json is found: the installed package root. */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new HatsError('INTERNAL', 'could not locate package root from module path', {
    from: import.meta.url,
  });
}

/** Shipped starter skills and rules (data, not code). */
export function packDir(): string {
  return path.join(packageRoot(), 'packs');
}

/** The sandbox child entrypoint. Plain .mjs so it needs no build and no package.json read. */
export function sandboxRunnerPath(): string {
  return path.join(packageRoot(), 'runtime', 'sandbox-runner.mjs');
}

/** $HATS_HOME or ~/.hats — everything the runtime owns lives under here. */
export function hatsHome(): string {
  const env = process.env['HATS_HOME'];
  if (env && env.trim()) return path.resolve(env);
  return path.join(homedir(), '.hats');
}

export function configPath(): string {
  return path.join(hatsHome(), 'config.json');
}

export function registryDir(): string {
  return path.join(hatsHome(), 'registry');
}

/**
 * ADR-0011: tools the agent wrote itself, one directory each.
 *
 * Deliberately outside the repository. Nothing an agent generated can end up in a commit
 * by accident, and revoking a tool is deleting a directory rather than editing source.
 */
export function generatedToolsDir(): string {
  // One place on the device, shared by every workspace. A connector is a capability of this
  // machine rather than of one project — having built a tool for an internal API once, the
  // agent should have it everywhere, not rebuild it per directory.
  return path.join(hatsHome(), 'tools');
}

/** One JSON file per schedule, so the panel and the daemon never write the same file. */
export function schedulesDir(): string {
  return path.join(hatsHome(), 'schedules');
}

/** Holds the pid of the running scheduler; two of them would fire everything twice. */
export function schedulerLockPath(): string {
  return path.join(hatsHome(), 'scheduler.lock');
}

/** Standing grants (ADR-0009): one file each, so concurrent writers never clobber. */
export function grantsDir(): string {
  return path.join(hatsHome(), 'grants');
}

/** Inbound messages that have already been handled, so a restart does not re-run them. */
export function channelStateDir(): string {
  return path.join(hatsHome(), 'channels');
}

/**
 * A workspace is the local analogue of the paper's tenant (REPO_RULES §7 open question 1).
 * Slug = basename + short hash of the real path, so two `src` directories never collide.
 */
export function workspaceSlug(dir: string): string {
  const real = existsSync(dir) ? realpathSync(dir) : path.resolve(dir);
  const base = path.basename(real).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'workspace';
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

export function workspaceDir(slug: string): string {
  return path.join(hatsHome(), 'workspaces', slug);
}

export function runDir(slug: string, runId: string): string {
  return path.join(workspaceDir(slug), 'runs', runId);
}

/**
 * Resolves a candidate path and refuses anything that escapes the declared roots.
 * Non-existent targets are allowed (you have to be able to create a file) but their
 * nearest existing ancestor is realpath'd, so `ok/../../../etc/passwd` and a symlinked
 * parent are both caught.
 */
export class PathGuard {
  private readonly roots: string[];

  constructor(roots: string[]) {
    this.roots = roots
      .filter(Boolean)
      .map((r) => (existsSync(r) ? realpathSync(r) : path.resolve(r)));
    if (this.roots.length === 0) {
      throw new HatsError('INTERNAL', 'PathGuard constructed with no roots', {});
    }
  }

  get declaredRoots(): readonly string[] {
    return this.roots;
  }

  /** @param base directory relative paths resolve against (normally the workspace root). */
  resolve(candidate: string, base?: string): string {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      throw new HatsError('SCOPE_DENIED', 'empty path', { candidate });
    }
    if (candidate.includes('\0')) {
      throw new HatsError('SCOPE_DENIED', 'path contains a null byte', { candidate });
    }
    const expanded = candidate.startsWith('~')
      ? path.join(homedir(), candidate.slice(1))
      : candidate;
    const absolute = path.resolve(base ?? this.roots[0]!, expanded);
    const real = realpathOfNearestAncestor(absolute);

    for (const root of this.roots) {
      if (real === root || real.startsWith(root + path.sep)) return real;
    }
    throw new HatsError(
      'SCOPE_DENIED',
      `path is outside the workspace: ${candidate}`,
      { candidate, resolved: real, roots: this.roots },
      'rule/workspace-scope',
    );
  }

  /** Non-throwing form, for building the model-visible file listings. */
  contains(candidate: string, base?: string): boolean {
    try {
      this.resolve(candidate, base);
      return true;
    } catch {
      return false;
    }
  }
}

function realpathOfNearestAncestor(absolute: string): string {
  let existing = absolute;
  const trailing: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute; // reached the filesystem root
    trailing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...trailing);
}
