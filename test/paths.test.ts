import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { PathGuard, workspaceSlug } from '../src/core/paths.js';
import { cleanup, tempWorkspace } from './helpers.js';

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
