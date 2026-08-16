/**
 * File-store primitives. ADR-0003: JSON + JSONL, no database.
 *
 * Two write disciplines, deliberately different:
 *  - `writeJsonAtomic` for anything a reader must never see half-written (config,
 *    persona, run record): temp file in the same directory, then rename.
 *  - `appendJsonl` for append-only records (audit, transcript, lessons): a single
 *    `appendFile` of one line. This is why the audit trail is JSONL and not a
 *    rewritten JSON array — a crash can lose the last line, never the file.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from './errors.js';

export async function ensureDir(dir: string): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export function ensureDirSync(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return fallback;
    if (e instanceof SyntaxError) {
      throw new HatsError('CONFIG_INVALID', `${file} is not valid JSON: ${e.message}`, { file });
    }
    throw e;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

export async function appendJsonl(
  file: string,
  record: unknown,
  opts: { mode?: number } = {},
): Promise<void> {
  await ensureDir(path.dirname(file));
  // `mode` only applies when appendFile creates the file, which is the case that matters:
  // a store holding conversation content must never exist world-readable, not even for
  // the moment between creation and a later chmod.
  await fsp.appendFile(file, JSON.stringify(record) + '\n', {
    encoding: 'utf8',
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
  });
}

/** Tolerant JSONL reader: a torn final line is skipped, not fatal. */
export async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* torn or hand-edited line: skip, keep the rest usable */
    }
  }
  return out;
}

/**
 * Rewrites a JSONL file in place (used when a record's mutable fields change, e.g.
 * lesson confidence). Atomic via temp+rename so a crash cannot empty the store.
 */
export async function rewriteJsonl(file: string, records: unknown[]): Promise<void> {
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  await writeTextAtomic(file, body ? body + '\n' : '');
}

export async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Short stable id for content-derived keys (artifact dedupe, lesson identity). */
export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function utcStamp(d = new Date()): string {
  return d.toISOString();
}

/** Sortable, human-readable run id: 20260814T101500Z-a1b2c3. */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${randomUUID().slice(0, 6)}`;
}
