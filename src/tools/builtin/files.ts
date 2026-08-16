/**
 * Filesystem tools. Every path goes through ctx.guard (rule/workspace-scope) — these
 * handlers never call path.resolve themselves.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from '../../core/errors.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';
import { nearMiss } from '../../engine/vigilance.js';

/** Directories that are never worth a step. Overridable per call, deliberately not by default. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.turbo',
  '.gradle',
  'Pods',
]);

const MAX_READ_BYTES = 512 * 1024;
const MAX_WALK_ENTRIES = 20_000;

export const listDir: ToolHandler = {
  spec: {
    name: 'list_dir',
    description:
      'List files and directories under a path in the workspace, with sizes. Use this before reading, to find candidates cheaply, and to find or count files *by name* — `name_pattern` filters on the filename, which search_files does not do. Skips node_modules, .git, dist and similar generated directories.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the workspace root. Defaults to the root.' },
        depth: { type: 'integer', description: 'How many levels deep. 1-4, default 2.', minimum: 1, maximum: 4 },
        name_pattern: {
          type: 'string',
          description:
            'Regular expression matched against each entry\'s path, e.g. "\\.md$" for markdown files. Directories are kept so the shape stays readable. Use this rather than search_files when the question is about names.',
        },
      },
      required: [],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    // An empty string is not nullish, so `?? '.'` does not catch it and the guard rejects
    // it as an empty path. Models pass "" for "the root" often enough that spending a step
    // on it is our bug, not theirs. [Seen in a live Sonnet run, 2026-08-14.]
    const target = ctx.guard.resolve(String(args['path'] || '.'), ctx.workspaceRoot);
    const depth = Number(args['depth'] ?? 2);
    const all = await walk(target, depth, ctx.workspaceRoot);

    // Filtering by name belongs here, not in search_files.
    //
    // search_files looks *inside* files and returns matching lines, which is the right tool
    // for "where is this written" and the wrong one for "which files are called this". Asked
    // to count the .md files under packs, a run reached for search_files with the pattern
    // \.md$, got a truthful "no matches" — no line inside those files ends in .md — and had
    // to recover. It picked the wrong tool because the right one did not exist.
    const raw = typeof args['name_pattern'] === 'string' ? args['name_pattern'].trim() : '';
    let match: RegExp | null = null;
    if (raw) {
      try {
        match = new RegExp(raw);
      } catch (e) {
        throw new HatsError('TOOL_INPUT_INVALID', `name_pattern is not a valid regular expression: ${(e as Error).message}`, {
          pattern: raw,
        });
      }
    }
    const entries = match ? all.filter((e) => e.isDir || match.test(e.rel)) : all;

    const lines = entries.map((e) =>
      e.isDir ? `${e.rel}/` : `${e.rel}  ${formatBytes(e.size)}`,
    );
    const dirs = entries.filter((e) => e.isDir).length;
    return {
      summary:
        lines.length === 0
          ? `(empty) ${path.relative(ctx.workspaceRoot, target) || '.'}`
          : `${entries.length - dirs} files, ${dirs} directories under ${path.relative(ctx.workspaceRoot, target) || '.'} (depth ${depth}):\n${lines.join('\n')}`,
      payload: entries,
      provenance: { path: target, depth, ...(raw ? { namePattern: raw } : {}) },
    };
  },
};

export const readFile: ToolHandler = {
  spec: {
    name: 'read_file',
    description:
      'Read a text file from the workspace. Optionally a line range — prefer a range over reading a large file whole. Returns content with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        start_line: { type: 'integer', description: '1-indexed first line.', minimum: 1 },
        end_line: { type: 'integer', description: '1-indexed last line, inclusive.', minimum: 1 },
      },
      required: ['path'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    const file = ctx.guard.resolve(String(args['path']), ctx.workspaceRoot);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw new HatsError('TOOL_FAILED', `no such file: ${args['path']}`, { file });
    if (stat.isDirectory()) {
      throw new HatsError('TOOL_FAILED', `${args['path']} is a directory — use list_dir`, { file });
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new HatsError(
        'TOOL_FAILED',
        `${args['path']} is ${formatBytes(stat.size)}, over the ${formatBytes(MAX_READ_BYTES)} read limit. Use search_files to locate the region, then read a line range.`,
        { file, size: stat.size },
      );
    }

    const raw = await fsp.readFile(file, 'utf8');
    if (looksBinary(raw)) {
      throw new HatsError('TOOL_FAILED', `${args['path']} looks binary, not text`, { file });
    }
    const allLines = raw.split('\n');
    const start = Math.max(1, Number(args['start_line'] ?? 1));
    const end = Math.min(allLines.length, Number(args['end_line'] ?? allLines.length));
    const slice = allLines.slice(start - 1, end);
    const numbered = slice.map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join('\n');

    const rel = path.relative(ctx.workspaceRoot, file);
    const range = start === 1 && end === allLines.length ? '' : ` lines ${start}-${end} of ${allLines.length}`;
    return {
      summary: `${rel}${range}\n${numbered}`,
      payload: { path: rel, lines: allLines.length, content: raw },
      provenance: { path: file, start, end, bytes: stat.size },
    };
  },
};

export const searchFiles: ToolHandler = {
  spec: {
    name: 'search_files',
    description:
      'Regex search *inside* workspace files: it reads their contents and returns matching lines with file and line number. It does not match filenames — to find or count files by name, use list_dir with name_pattern. Narrow the path and the pattern; a broad search at the root wastes a step.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression.' },
        path: { type: 'string', description: 'Directory to search under. Defaults to the workspace root.' },
        extensions: {
          type: 'string',
          description: 'Comma-separated file extensions to include, e.g. "ts,tsx". Default: all text files.',
        },
        max_results: { type: 'integer', description: 'Cap on matches returned. Default 60.', minimum: 1, maximum: 500 },
        context: {
          type: 'integer',
          description:
            'Lines of surrounding context to return with each match, above and below. Default 0. Two or three is usually the difference between knowing a symbol exists and knowing what it does — cheaper than reading the whole file afterwards.',
          minimum: 0,
          maximum: 10,
        },
        ignore_case: {
          type: 'boolean',
          description:
            'Match without regard to case. Default true. Set it false when the case is the point — Config and config are different identifiers, and a case-blind search for one of them returns both.',
        },
        files_only: {
          type: 'boolean',
          description:
            'Return the list of files that contain a match and how many each has, instead of the matching lines. Use it when the question is "where does this live", not "what does it say".',
        },
      },
      required: ['pattern'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    const root = ctx.guard.resolve(String(args['path'] || '.'), ctx.workspaceRoot);
    const max = Number(args['max_results'] ?? 60);
    const exts = String(args['extensions'] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^\./, ''))
      .filter(Boolean);

    // Models write /foo/ as often as foo, and a literal slash-wrapped pattern matches
    // nothing while looking like a real search that found nothing. Strip the delimiters.
    // [Found in a live run, 2026-08-14: the model burned four steps on //working paper//.]
    const rawPattern = String(args['pattern']);
    const pattern =
      rawPattern.length > 2 && rawPattern.startsWith('/') && /\/[gimsuy]*$/.test(rawPattern)
        ? rawPattern.slice(1, rawPattern.lastIndexOf('/'))
        : rawPattern;

    const ignoreCase = args['ignore_case'] !== false;
    let re: RegExp;
    try {
      re = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
    } catch (e) {
      throw new HatsError('TOOL_INPUT_INVALID', `invalid regex: ${(e as Error).message}`, {
        pattern: args['pattern'],
      });
    }

    // A model that passes a file where a directory is expected means "search this file".
    // Walking a file yields nothing, and "no matches in 0 files" reads like a real answer
    // rather than a mistake — so do what was meant. [Found in a live run, 2026-08-14.]
    const rootStat = await fsp.stat(root).catch(() => null);
    const entries = rootStat?.isFile()
      ? [
          {
            abs: root,
            rel: path.relative(ctx.workspaceRoot, root),
            isDir: false,
            size: rootStat.size,
          },
        ]
      : await walk(root, 12, ctx.workspaceRoot);
    const context = Math.min(Number(args['context'] ?? 0), 10);
    const filesOnly = args['files_only'] === true;
    const hits: Hit[] = [];
    const perFile: Array<{ file: string; matches: number }> = [];
    let filesScanned = 0;

    for (const entry of entries) {
      if (entry.isDir) continue;
      if (exts.length > 0 && !exts.includes(path.extname(entry.abs).replace(/^\./, ''))) continue;
      if (entry.size > MAX_READ_BYTES) continue;
      let content: string;
      try {
        content = await fsp.readFile(entry.abs, 'utf8');
      } catch {
        continue;
      }
      if (looksBinary(content)) continue;
      filesScanned++;
      const lines = content.split('\n');
      let inThisFile = 0;
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        re.lastIndex = 0;
        const line = lines[i] ?? '';
        if (!re.test(line)) continue;
        inThisFile++;
        if (filesOnly) continue;
        const hit: Hit = { file: entry.rel, line: i + 1, text: line.trim().slice(0, 240) };
        if (context > 0) {
          hit.before = lines.slice(Math.max(0, i - context), i).map((l) => l.slice(0, 240));
          hit.after = lines.slice(i + 1, i + 1 + context).map((l) => l.slice(0, 240));
        }
        hits.push(hit);
      }
      if (inThisFile > 0) perFile.push({ file: entry.rel, matches: inThisFile });
      if (!filesOnly && hits.length >= max) break;
      if (filesOnly && perFile.length >= max) break;
    }

    // "Where does this live" and "what does it say" are different questions, and answering
    // the first with a hundred matching lines is how a search eats a context window.
    if (filesOnly) {
      const body = perFile.map((f) => `${f.file} (${f.matches})`).join('\n');
      return {
        summary:
          perFile.length === 0
            ? `no file under ${path.relative(ctx.workspaceRoot, root) || '.'} contains /${pattern}/ (${filesScanned} searched)`
            : `${perFile.length} file(s) contain /${pattern}/:\n${body}`,
        payload: perFile,
        provenance: { pattern, rawPattern, root, filesScanned, filesOnly: true },
      };
    }

    const render = (h: Hit): string => {
      if (!context) return `${h.file}:${h.line}: ${h.text}`;
      const before = (h.before ?? []).map((l, k) => `  ${h.line - (h.before ?? []).length + k}  ${l}`);
      const after = (h.after ?? []).map((l, k) => `  ${h.line + k + 1}  ${l}`);
      return [`${h.file}:${h.line}`, ...before, `> ${h.line}  ${h.text}`, ...after].join('\n');
    };
    const body = hits.map(render).join(context ? '\n\n' : '\n');
    return {
      summary:
        hits.length === 0
          ? `no matches for /${pattern}/ in ${filesScanned} files under ${path.relative(ctx.workspaceRoot, root) || '.'}`
          : `${hits.length}${hits.length >= max ? '+ (capped)' : ''} matches in ${filesScanned} files:\n${body}`,
      payload: hits,
      provenance: { pattern, rawPattern, root, filesScanned, ...(context ? { context } : {}), ...(ignoreCase ? {} : { caseSensitive: true }) },
    };
  },
};

interface Hit {
  file: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}

export const writeFile: ToolHandler = {
  spec: {
    name: 'write_file',
    description:
      'Create or overwrite a file in the workspace. Requires human approval. Prefer apply_patch for edits to existing files — it fails loudly when the file is not what you expected.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
    },
    mutating: true,
    network: false,
    minProfile: 'assisted',
  },
  async run(args, ctx): Promise<ToolResult> {
    const file = ctx.guard.resolve(String(args['path']), ctx.workspaceRoot, 'write');
    const content = String(args['content']);
    const existed = await fsp
      .stat(file)
      .then(() => true)
      .catch(() => false);

    // The most common fatal error in unattended work is a single wrong character in a
    // path. The write succeeds, the tool says "written", and everything downstream refers
    // to a file nobody will ever find. The one clue available here is that a near-identical
    // name already sits next to it.
    const dir = path.dirname(file);
    const siblings = existed ? [] : await fsp.readdir(dir).catch(() => [] as string[]);
    const suspect = existed ? null : nearMiss(file, siblings);

    // A brand-new directory for a single file is the other shape this takes: the folder was
    // misspelt, so nothing was there to compare against.
    const dirExisted = await fsp
      .stat(dir)
      .then(() => true)
      .catch(() => false);

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, content, 'utf8');
    const rel = path.relative(ctx.workspaceRoot, file);

    const warnings: string[] = [];
    if (suspect) {
      warnings.push(
        `"${path.basename(file)}" is one character from "${suspect}", which already exists here. ` +
          `If you meant that file, this write went somewhere nobody will look.`,
      );
    }
    if (!dirExisted) {
      warnings.push(
        `the directory "${path.relative(ctx.workspaceRoot, dir)}" did not exist and was created. ` +
          `If you expected it to exist, the path is wrong.`,
      );
    }
    if (warnings.length) {
      ctx.logger.warn('write.suspicious-path', { path: rel, warnings });
    }

    return {
      summary:
        `${existed ? 'overwrote' : 'created'} ${rel} (${content.length} bytes)` +
        (warnings.length ? `\n  check this: ${warnings.join(' ')}` : ''),
      payload: { path: rel, bytes: content.length, existed, ...(warnings.length ? { warnings } : {}) },
      provenance: { path: file, existed },
    };
  },
};

export const applyPatch: ToolHandler = {
  spec: {
    name: 'apply_patch',
    description:
      'Replace an exact string in a file. The find text must appear exactly once — if it does not, the call fails and nothing is written. Requires human approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        find: { type: 'string', description: 'Exact text to replace, including indentation.' },
        replace: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'find', 'replace'],
    },
    mutating: true,
    network: false,
    minProfile: 'assisted',
  },
  async run(args, ctx): Promise<ToolResult> {
    const file = ctx.guard.resolve(String(args['path']), ctx.workspaceRoot, 'write');
    const find = String(args['find']);
    const replace = String(args['replace']);
    const raw = await fsp.readFile(file, 'utf8').catch(() => {
      throw new HatsError('TOOL_FAILED', `no such file: ${args['path']}`, { file });
    });

    const occurrences = countOccurrences(raw, find);
    if (occurrences === 0) {
      throw new HatsError(
        'TOOL_FAILED',
        `the find text does not appear in ${args['path']}. Read the file again — it is not what you expected.`,
        { file },
      );
    }
    if (occurrences > 1) {
      throw new HatsError(
        'TOOL_FAILED',
        `the find text appears ${occurrences} times in ${args['path']}; include more surrounding context so it is unique.`,
        { file, occurrences },
      );
    }

    await fsp.writeFile(file, raw.replace(find, replace), 'utf8');
    const rel = path.relative(ctx.workspaceRoot, file);
    return {
      summary: `patched ${rel} (${find.length} bytes -> ${replace.length} bytes)`,
      payload: { path: rel, before: find, after: replace },
      provenance: { path: file },
    };
  },
};

interface Entry {
  abs: string;
  rel: string;
  isDir: boolean;
  size: number;
}

async function walk(root: string, maxDepth: number, base: string): Promise<Entry[]> {
  const out: Entry[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && out.length < MAX_WALK_ENTRIES) {
    const next = queue.shift();
    if (!next) break;
    let dirents;
    try {
      dirents = await fsp.readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (d.name.startsWith('.') && d.name !== '.github') continue;
      const abs = path.join(next.dir, d.name);
      const rel = path.relative(base, abs) || d.name;
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        out.push({ abs, rel, isDir: true, size: 0 });
        if (next.depth + 1 < maxDepth) queue.push({ dir: abs, depth: next.depth + 1 });
      } else if (d.isFile()) {
        const stat = await fsp.stat(abs).catch(() => null);
        out.push({ abs, rel, isDir: false, size: stat?.size ?? 0 });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** A NUL byte, or a high share of control characters, means this is not text. */
function looksBinary(sample: string): boolean {
  const head = sample.slice(0, 1_000);
  if (head.includes('\u0000')) return true;
  let control = 0;
  for (let i = 0; i < head.length; i++) {
    const code = head.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) control++;
  }
  return head.length > 0 && control / head.length > 0.1;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export const fileTools: ToolHandler[] = [listDir, readFile, searchFiles, writeFile, applyPatch];
