/**
 * A deliberately small YAML subset for skill and rule headers.
 *
 * ADR-0003 forbids a runtime dependency, and a full YAML parser is the wrong shape of
 * thing to own. What skill/rule headers actually need is: scalars, block lists, inline
 * lists, and block scalars (`>` / `|`) for rule statements. Anything outside that is a
 * parse error with a line number rather than a silent misread — a header that parses
 * wrongly would silently widen an allowlist.
 */

import { HatsError } from '../core/errors.js';

export type FrontmatterValue = string | number | boolean | string[] | null;
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedDocument {
  frontmatter: Frontmatter;
  body: string;
}

export function parseDocument(raw: string, source = '<memory>'): ParsedDocument {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) {
    return { frontmatter: {}, body: text.trim() };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    throw new HatsError('REGISTRY_INVALID', `${source}: frontmatter opened but never closed`, {
      source,
    });
  }
  const header = text.slice(text.indexOf('\n') + 1, end);
  const body = text.slice(end + 4).replace(/^\n/, '');
  return { frontmatter: parseFrontmatter(header, source), body: body.trim() };
}

export function parseFrontmatter(header: string, source = '<memory>'): Frontmatter {
  const out: Frontmatter = {};
  const lines = header.split('\n');
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i] ?? '';
    const line = stripComment(rawLine);
    i++;
    if (!line.trim()) continue;

    if (/^\s/.test(rawLine) && !/^\s*-\s/.test(rawLine)) {
      throw new HatsError(
        'REGISTRY_INVALID',
        `${source}: unexpected indentation at line ${i} — nested maps are not supported`,
        { line: rawLine },
      );
    }

    const colon = indexOfTopLevelColon(line);
    if (colon === -1) {
      throw new HatsError('REGISTRY_INVALID', `${source}: line ${i} is not "key: value"`, {
        line: rawLine,
      });
    }
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();

    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const { value, next } = readBlockScalar(lines, i, rest.startsWith('|'));
      out[key] = value;
      i = next;
      continue;
    }
    if (rest === '') {
      const { value, next } = readBlockList(lines, i);
      out[key] = value;
      i = next;
      continue;
    }
    out[key] = parseScalar(rest);
  }
  return out;
}

function readBlockList(lines: string[], start: number): { value: string[]; next: number } {
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    if (!raw.trim()) {
      i++;
      continue;
    }
    const m = /^\s*-\s*(.*)$/.exec(stripComment(raw));
    if (!m) break;
    items.push(String(parseScalar((m[1] ?? '').trim())));
    i++;
  }
  return { value: items, next: i };
}

function readBlockScalar(
  lines: string[],
  start: number,
  literal: boolean,
): { value: string; next: number } {
  const collected: string[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    if (raw.trim() && !/^\s+/.test(raw)) break;
    collected.push(raw.replace(/^\s{1,4}/, ''));
    i++;
  }
  while (collected.length && !collected[collected.length - 1]?.trim()) collected.pop();
  return { value: literal ? collected.join('\n') : collected.join(' ').replace(/\s+/g, ' ').trim(), next: i };
}

function parseScalar(raw: string): FrontmatterValue {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => String(unquote(s.trim())));
  }
  return unquote(v);
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Strips `# comment`, respecting quotes so URLs and `#` inside strings survive. */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      const prev = line[i - 1];
      if (i === 0 || prev === ' ' || prev === '\t') return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function indexOfTopLevelColon(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) return i;
  }
  return -1;
}

// --- typed accessors: a header that lies should fail loudly at load, not at run ---

export function asString(fm: Frontmatter, key: string, source: string): string {
  const v = fm[key];
  if (typeof v === 'string' && v) return v;
  throw new HatsError('REGISTRY_INVALID', `${source}: "${key}" must be a non-empty string`, {
    key,
    got: v,
  });
}

export function asOptionalString(fm: Frontmatter, key: string): string | undefined {
  const v = fm[key];
  return typeof v === 'string' && v ? v : undefined;
}

export function asNumber(fm: Frontmatter, key: string, fallback: number): number {
  const v = fm[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function asBoolean(fm: Frontmatter, key: string, fallback = false): boolean {
  const v = fm[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function asList(fm: Frontmatter, key: string): string[] {
  const v = fm[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

export function asEnum<T extends string>(
  fm: Frontmatter,
  key: string,
  allowed: readonly T[],
  fallback: T,
  source: string,
): T {
  const v = fm[key];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  throw new HatsError('REGISTRY_INVALID', `${source}: "${key}" must be one of ${allowed.join('|')}`, {
    key,
    got: v,
  });
}
