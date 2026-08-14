/**
 * Keys are the one thing in this system that must never come back out.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import {
  clearCredential,
  credentialHint,
  credentialsPath,
  getCredential,
  resetCredentialCache,
  setCredential,
} from '../src/core/credentials.js';
import { resolveApiKeyWithSource } from '../src/core/config.js';
import { cleanup, tempHome } from './helpers.js';

test('a stored key is written 0600 and kept out of config.json', async () => {
  const home = await tempHome();
  resetCredentialCache();

  await setCredential('anthropic', 'sk-test-abcdefgh1234');
  const stat = await fsp.stat(credentialsPath());
  assert.equal(stat.mode & 0o777, 0o600, 'credentials must not be readable by other users');

  const raw = await fsp.readFile(credentialsPath(), 'utf8');
  assert.match(raw, /sk-test-abcdefgh1234/);

  // The file people share must never contain it.
  const configText = await fsp.readFile(credentialsPath(), 'utf8').catch(() => '');
  assert.ok(!configText.includes('"providers"'), 'credentials live in their own file');
  await cleanup(home);
});

test('precedence: an explicitly stored key beats an ambient environment variable', async () => {
  const home = await tempHome();
  resetCredentialCache();
  process.env['ANTHROPIC_API_KEY'] = 'sk-from-env';

  const conf = { kind: 'anthropic' as const, baseUrl: 'https://x', apiKeyEnv: 'ANTHROPIC_API_KEY' };

  const fromEnv = resolveApiKeyWithSource('anthropic', conf);
  assert.equal(fromEnv.key, 'sk-from-env');
  assert.equal(fromEnv.source, 'env');

  await setCredential('anthropic', 'sk-stored-deliberately');
  const stored = resolveApiKeyWithSource('anthropic', conf);
  assert.equal(stored.key, 'sk-stored-deliberately');
  assert.equal(stored.source, 'stored');

  delete process.env['ANTHROPIC_API_KEY'];
  await cleanup(home);
});

test('clearing a key removes it and falls back to the environment', async () => {
  const home = await tempHome();
  resetCredentialCache();
  await setCredential('openai', 'sk-gone-soon');
  assert.equal(getCredential('openai'), 'sk-gone-soon');

  await clearCredential('openai');
  assert.equal(getCredential('openai'), undefined);
  await cleanup(home);
});

test('the hint reveals four characters and never the key', () => {
  assert.equal(credentialHint('sk-abcdefghijkl9999'), '••••9999');
  assert.equal(credentialHint('ab'), '••••');
  assert.equal(credentialHint(undefined), null);

  const hint = credentialHint('sk-secret-value-here');
  assert.ok(!hint?.includes('secret'), 'the hint must not leak the body of the key');
});
