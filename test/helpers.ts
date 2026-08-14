import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG, type HatsConfig } from '../src/core/config.js';

/** Each test gets its own $HATS_HOME so nothing touches the developer's real store. */
export async function tempHome(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hats-test-'));
  process.env['HATS_HOME'] = dir;
  return dir;
}

export async function tempWorkspace(files: Record<string, string> = {}): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hats-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content, 'utf8');
  }
  return dir;
}

export function testConfig(over: Partial<HatsConfig> = {}): HatsConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  return {
    ...base,
    ...over,
    defaultProvider: 'mock',
    providers: {
      mock: { kind: 'mock', baseUrl: '', models: { light: 'm', standard: 'm', frontier: 'm' } },
    },
    tiers: { light: 'mock/m', standard: 'mock/m', frontier: 'mock/m' },
  };
}

export async function cleanup(...dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
