/**
 * ADR-0010: the agent repairs a tool's behaviour, never its authority.
 *
 * A patch is a find/replace against one file, staged like any other proposal. Applying it
 * runs four checks in order, and the file is restored if any of them fails:
 *
 *   1. the path is one the agent may touch at all
 *   2. neither side of the edit mentions a tool's declared powers
 *   3. the project still compiles
 *   4. the whole test suite still passes, security tests included
 *
 * Check 4 is the substantive one. The suite already encodes the boundaries — sandbox
 * escape, path guard, grant scope, unattended denial — so "the tests still pass" is a real
 * statement about safety rather than a formality. It is also why the whole suite runs
 * rather than a fast subset: a boundary with no test can be patched away silently, and
 * narrowing what we run widens what can slip through.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { HatsError } from '../core/errors.js';
import { packageRoot } from '../core/paths.js';
import { exists } from '../core/store.js';

/**
 * Directories the agent may edit. Deliberately narrow: tool handlers, and the markdown
 * packs. Everything that decides what is *permitted* lives elsewhere.
 */
const EDITABLE = ['src/tools/builtin', 'src/tools/sandbox', 'packs'];

/**
 * Never editable, even if a path above would otherwise allow it. These are the files that
 * enforce the boundaries; a patch that wants one of them is not fixing a locator.
 */
const PROTECTED = [
  'src/tools/executor.ts',
  'src/tools/types.ts',
  'src/core/paths.ts',
  'src/core/net.ts',
  'src/core/credentials.ts',
  'src/core/config.ts',
  'src/engine/gates.ts',
  'src/schedule/grants.ts',
  'src/schedule/unattended.ts',
  'src/registry/patches.ts',
];

/**
 * A tool's declared powers. The executor builds the allowlist and decides what needs
 * approval from these, so an edit that touches one is a capability change wearing a bug
 * fix's clothes — refused whichever side of the find/replace it appears on.
 */
const AUTHORITY = /\b(mutating|network|minProfile|availableWhen)\s*:/;

export interface Patch {
  id: string;
  /** Repo-relative path. */
  file: string;
  /** Exact text to replace. Must appear exactly once. */
  find: string;
  replace: string;
  /** What is broken and why this fixes it, in the agent's words. */
  reason: string;
  /** Run ids that hit the defect. */
  evidence: string[];
  createdByRun?: string;
}

export interface PatchOutcome {
  applied: boolean;
  /** Which check refused it, or how the verification failed. */
  reason: string;
  stage: 'path' | 'authority' | 'match' | 'build' | 'test' | 'applied';
  detail?: string;
}

/** Checks 1 and 2. Pure, so the tool can refuse at staging time as well as at promotion. */
export function validatePatch(patch: Patch): PatchOutcome {
  const file = patch.file.replace(/^\.\//, '');
  if (file.includes('..') || path.isAbsolute(file)) {
    return { applied: false, stage: 'path', reason: `"${patch.file}" is not a repo-relative path` };
  }
  if (PROTECTED.some((p) => file === p)) {
    return {
      applied: false,
      stage: 'path',
      reason:
        `${file} enforces the boundaries and cannot be patched. Fixing a tool's behaviour ` +
        `never requires editing the executor, the guards, the gates or the grant store.`,
    };
  }
  if (!EDITABLE.some((dir) => file === dir || file.startsWith(dir + '/'))) {
    return {
      applied: false,
      stage: 'path',
      reason: `${file} is outside the editable area (${EDITABLE.join(', ')})`,
    };
  }
  for (const [side, text] of [
    ['find', patch.find],
    ['replace', patch.replace],
  ] as const) {
    if (AUTHORITY.test(text)) {
      return {
        applied: false,
        stage: 'authority',
        reason:
          `the ${side} text changes a tool's declared powers (mutating, network, minProfile ` +
          `or availableWhen). Those are set by a person and stay that way — patch the ` +
          `behaviour, not the permission.`,
      };
    }
  }
  if (!patch.find.trim()) {
    return { applied: false, stage: 'match', reason: 'the find text is empty' };
  }
  return { applied: true, stage: 'applied', reason: 'passes the static checks' };
}

export interface ApplyOptions {
  root?: string;
  /** Overridden in tests so the suite does not run itself recursively. */
  verify?: (root: string) => Promise<{ ok: boolean; stage: 'build' | 'test'; detail: string }>;
}

/**
 * Applies a patch, verifies it, and restores the original if verification fails. The file
 * is only left changed when the build and the whole test suite both pass.
 */
export async function applyPatch(patch: Patch, opts: ApplyOptions = {}): Promise<PatchOutcome> {
  const statik = validatePatch(patch);
  if (!statik.applied) return statik;

  const root = opts.root ?? packageRoot();
  const target = path.join(root, patch.file);
  if (!(await exists(target))) {
    return { applied: false, stage: 'path', reason: `${patch.file} does not exist` };
  }

  const before = await readFile(target, 'utf8');
  const located = locate(before, patch.find, patch.replace);
  if (located.error) return { applied: false, stage: 'match', reason: located.error };

  await writeFile(target, located.next as string, 'utf8');

  const verify = opts.verify ?? runBuildAndTests;
  let result: { ok: boolean; stage: 'build' | 'test'; detail: string };
  try {
    result = await verify(root);
  } catch (e) {
    result = { ok: false, stage: 'build', detail: (e as Error).message };
  }

  if (!result.ok) {
    // Restored before returning: a refused patch must leave the tree exactly as it was,
    // including when the verification itself blew up.
    await writeFile(target, before, 'utf8');
    return {
      applied: false,
      stage: result.stage,
      reason:
        result.stage === 'build'
          ? `the patch does not compile, so it was reverted`
          : `the patch compiles but breaks the test suite, so it was reverted`,
      detail: result.detail.slice(0, 4_000),
    };
  }

  return {
    applied: true,
    stage: 'applied',
    reason: `applied to ${patch.file}; the build and the full test suite both pass`,
  };
}

/**
 * Finds the region to replace, tolerating indentation.
 *
 * An exact match is tried first. When that fails, lines are compared with their leading
 * whitespace stripped and the replacement is re-indented to match the file. This is not
 * laziness: `read_file` returns line-numbered output, so a model quoting a block back
 * reliably gets the indentation wrong by however wide the line-number gutter was. The
 * first real patch the agent wrote was correct in every character except six spaces.
 * [Seen in a live run, 2026-08-14.]
 */
export function locate(
  source: string,
  find: string,
  replace: string,
): { next?: string; error?: string } {
  const exact = source.split(find).length - 1;
  if (exact === 1) return { next: source.replace(find, replace) };
  if (exact > 1) return { error: `the find text appears ${exact} times; it must be unique` };

  const src = source.split('\n');
  const needle = find.split('\n');
  const strip = (l: string) => l.trim();
  const hits: number[] = [];
  for (let i = 0; i + needle.length <= src.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (strip(src[i + j] ?? '') !== strip(needle[j] ?? '')) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }

  if (hits.length === 0) {
    return { error: 'the find text does not appear in the file — it may already be fixed' };
  }
  if (hits.length > 1) {
    return { error: `the find text matches ${hits.length} places; include more context` };
  }

  // Re-indent the replacement by the difference between what the model wrote and what the
  // file actually has, so the patched block lines up with its neighbours.
  const at = hits[0] as number;
  const fileIndent = leading(src[at] ?? '');
  const patchIndent = leading(needle[0] ?? '');
  const shift = fileIndent.length - patchIndent.length;
  const reindented = replace.split('\n').map((line) => {
    if (!line.trim()) return line;
    if (shift >= 0) return ' '.repeat(shift) + line;
    return line.startsWith(' '.repeat(-shift)) ? line.slice(-shift) : line.trimStart();
  });

  const next = [...src.slice(0, at), ...reindented, ...src.slice(at + needle.length)];
  return { next: next.join('\n') };
}

function leading(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? '';
}

async function runBuildAndTests(
  root: string,
): Promise<{ ok: boolean; stage: 'build' | 'test'; detail: string }> {
  const build = await run('npm', ['run', 'build'], root, 300_000);
  if (build.code !== 0) return { ok: false, stage: 'build', detail: build.output };
  const tests = await run('npm', ['test'], root, 600_000);
  if (tests.code !== 0) return { ok: false, stage: 'test', detail: tests.output };
  return { ok: true, stage: 'test', detail: tests.output.slice(-2_000) };
}

function run(
  bin: string,
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const take = (d: Buffer) => {
      if (output.length < 200_000) output += d.toString('utf8');
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}\ncould not run ${bin}: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

/** For `hats patches` and the panel: what a person needs to judge it. */
export function describePatch(patch: Patch): string {
  return [
    `# Patch to ${patch.file}`,
    '',
    patch.reason,
    '',
    '## Replace',
    '```',
    patch.find.slice(0, 2_000),
    '```',
    '',
    '## With',
    '```',
    patch.replace.slice(0, 2_000),
    '```',
    '',
    patch.evidence.length ? `## Runs that hit this\n\n${patch.evidence.map((e) => `- ${e}`).join('\n')}` : '',
    '',
    'Applying this runs the build and the entire test suite. If either fails the file is',
    'restored and nothing changes. A patch can never alter a tool’s declared powers.',
  ].join('\n');
}

export function assertPatchable(file: string): void {
  const outcome = validatePatch({ id: '', file, find: 'x', replace: 'y', reason: '', evidence: [] });
  if (!outcome.applied && outcome.stage === 'path') {
    throw new HatsError('TOOL_NOT_ALLOWED', outcome.reason, { file }, 'rule/registry-immutability');
  }
}
