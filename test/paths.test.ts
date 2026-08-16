import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { PathGuard, controlPlane, workspaceSlug } from '../src/core/paths.js';
import { cleanup, tempHome, tempWorkspace } from './helpers.js';

test('resolves paths inside the workspace and refuses everything else', async () => {
  const ws = await tempWorkspace({ 'src/a.ts': 'x', 'README.md': 'y' });
  const guard = new PathGuard([ws]);

  assert.equal(guard.resolve('src/a.ts', ws), path.join(await real(ws), 'src/a.ts'));
  assert.equal(guard.contains('src/a.ts', ws), true);

  assert.throws(() => guard.resolve('../outside.txt', ws), /outside the workspace/);
  assert.throws(() => guard.resolve('/etc/passwd', ws), /outside the workspace/);
  assert.throws(() => guard.resolve('src/../../etc/hosts', ws), /outside the workspace/);
  await cleanup(ws);
});

test('a symlink pointing out of the workspace is refused', async () => {
  const ws = await tempWorkspace({ 'src/a.ts': 'x' });
  const outside = await tempWorkspace({ 'secret.txt': 'nope' });
  await fsp.symlink(path.join(outside, 'secret.txt'), path.join(ws, 'link.txt'));

  const guard = new PathGuard([ws]);
  // The check is on the *resolved* path, which is the whole reason this is not startsWith.
  assert.throws(() => guard.resolve('link.txt', ws), /outside the workspace/);
  await cleanup(ws, outside);
});

test('a path that does not exist yet is allowed if its parent is inside', async () => {
  const ws = await tempWorkspace({});
  const guard = new PathGuard([ws]);
  const resolved = guard.resolve('new/dir/file.ts', ws);
  assert.ok(resolved.startsWith(await real(ws)));
  await cleanup(ws);
});

test('rejects null bytes and empty paths', async () => {
  const ws = await tempWorkspace({});
  const guard = new PathGuard([ws]);
  assert.throws(() => guard.resolve('', ws), /empty path/);
  assert.throws(() => guard.resolve(`a${String.fromCharCode(0)}b`, ws), /null byte/);
  await cleanup(ws);
});

/**
 * $HATS_HOME is in the agent's scope, and it is also where the permissions live. These
 * cover the second half of that: containment alone would let a run rewrite the rules it is
 * running under.
 */
test('the control plane inside $HATS_HOME is not writable through a path', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({});
  const guard = new PathGuard([ws, home], controlPlane(home));

  for (const target of [
    path.join(home, 'grants', 'grn_selfminted.json'),
    path.join(home, 'config.json'),
    path.join(home, 'schedules', 'nightly.json'),
    path.join(home, 'tools', 'backdoor', 'manifest.json'),
    path.join(home, 'registry', 'skills', 'core-discipline.md'),
  ]) {
    assert.throws(
      () => guard.resolve(target, ws, 'write'),
      /cannot be written as a file/,
      `${path.relative(home, target)} was writable`,
    );
    // Readable, though: knowing your own permissions is not the problem.
    assert.doesNotThrow(() => guard.resolve(target, ws));
  }

  // The workspace store and run artifacts are the reason $HATS_HOME is a root at all.
  assert.doesNotThrow(() => guard.resolve(path.join(home, 'workspaces', 'w', 'runs'), ws, 'write'));
  await cleanup(home, ws);
});

test('credentials.json is refused in both directions', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({});
  await fsp.writeFile(path.join(home, 'credentials.json'), '{"anthropic":"sk-ant-secret"}');
  const guard = new PathGuard([ws, home], controlPlane(home));

  for (const spelling of [path.join(home, 'credentials.json'), 'credentials.json']) {
    const base = spelling.startsWith(home) ? ws : home;
    assert.throws(() => guard.resolve(spelling, base), /holds credentials/);
    assert.throws(() => guard.resolve(spelling, base, 'write'), /holds credentials/);
  }
  await cleanup(home, ws);
});

test('a guard with no limits is unchanged, and read is the default mode', async () => {
  const ws = await tempWorkspace({ 'a.txt': 'x' });
  const guard = new PathGuard([ws]);
  assert.equal(guard.resolve('a.txt', ws), path.join(await real(ws), 'a.txt'));
  assert.equal(guard.resolve('a.txt', ws, 'write'), path.join(await real(ws), 'a.txt'));
  await cleanup(ws);
});

test('workspace slugs are stable and collision-resistant', async () => {
  const a = await tempWorkspace({});
  const b = await tempWorkspace({});
  assert.equal(workspaceSlug(a), workspaceSlug(a));
  assert.notEqual(workspaceSlug(a), workspaceSlug(b));
  await cleanup(a, b);
});

async function real(dir: string): Promise<string> {
  return fsp.realpath(dir);
}
