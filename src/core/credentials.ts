/**
 * API keys entered in the UI.
 *
 * They go in `$HATS_HOME/credentials.json`, mode 0600 — deliberately **not** in
 * `config.json`, because config is the file people open, diff, screenshot and paste into
 * issues. Keeping the two apart means the file you might share never contains a secret.
 *
 * Rules this module exists to enforce:
 *   - a stored key is never returned by any API, logged, or put in a run's context. The
 *     UI is told `set` and the last four characters, and nothing else. This file is also
 *     named in `controlPlane()`, so the path tools and the panel's file browser refuse to
 *     read it — otherwise "never returned by any API" would be true of this module and
 *     false of the product.
 *   - the only place a key is read is the provider's Authorization header.
 *   - `hats config show` prints config, which by construction has no keys in it.
 *
 * Honest limit: a 0600 file is not a keychain. Anything running as your user can read it,
 * exactly as it can read your environment. It is protected from other users and from
 * casual sharing, not from you being compromised.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { hatsHome } from './paths.js';

const FILE = 'credentials.json';
const MODE = 0o600;

let cache: Record<string, string> | null = null;

export function credentialsPath(): string {
  return path.join(hatsHome(), FILE);
}

/** Sync so `resolveApiKey` can stay sync; cached so it is not a read per request. */
export function readCredentials(): Record<string, string> {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    cache = Object.fromEntries(
      Object.entries(parsed)
        .filter(([, v]) => typeof v === 'string' && v)
        .map(([k, v]) => [k, String(v)]),
    );
  } catch {
    cache = {};
  }
  return cache;
}

export function getCredential(providerId: string): string | undefined {
  const value = readCredentials()[providerId];
  return value && value.trim() ? value.trim() : undefined;
}

export async function setCredential(providerId: string, key: string): Promise<void> {
  const current = { ...readCredentials() };
  const trimmed = key.trim();
  if (trimmed) current[providerId] = trimmed;
  else delete current[providerId];
  await write(current);
}

export async function clearCredential(providerId: string): Promise<void> {
  const current = { ...readCredentials() };
  delete current[providerId];
  await write(current);
}

async function write(values: Record<string, string>): Promise<void> {
  const file = credentialsPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  // Create restricted from the outset: never exists world-readable, even briefly.
  await fsp.writeFile(tmp, JSON.stringify(values, null, 2) + '\n', { encoding: 'utf8', mode: MODE });
  await fsp.rename(tmp, file);
  // rename preserves the temp file's mode, but be explicit in case the target pre-existed.
  await fsp.chmod(file, MODE).catch(() => undefined);
  cache = values;
}

/** What the UI is allowed to see. Never the key. */
export function credentialHint(value: string | undefined): string | null {
  if (!value) return null;
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/** For `hats doctor`: which source won, without revealing the value. */
export type KeySource = 'stored' | 'env' | 'config' | null;

export function describeKeySource(source: KeySource): string {
  switch (source) {
    case 'stored':
      return 'entered in the UI, stored 0600';
    case 'env':
      return 'from the environment';
    case 'config':
      return 'in config.json (move it: hats will read credentials.json instead)';
    default:
      return 'not set';
  }
}

/** Test seam and post-write invalidation. */
export function resetCredentialCache(): void {
  cache = null;
}
