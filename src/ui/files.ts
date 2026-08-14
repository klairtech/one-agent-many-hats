/**
 * Serving workspace files to the control panel.
 *
 * This is the one part of the UI that hands file *contents* to a browser, so the same
 * boundary that governs the agent governs it: every path goes through PathGuard and
 * resolves inside the workspace root or $HATS_HOME. The UI cannot reach anything the agent
 * could not.
 *
 * Two deliberate limits, both about not pretending:
 *   - HTML previews are served into a sandboxed iframe with no scripts and no same-origin
 *     access, so a page written by the agent — or fetched from somewhere — cannot touch the
 *     control panel or its token.
 *   - Office formats (.docx, .pptx, .xlsx) are zip archives of XML. Rendering them
 *     faithfully needs a real library, and a half-rendering is worse than an honest
 *     "open this in the app that owns it".
 */

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from '../core/errors.js';
import { PathGuard, hatsHome } from '../core/paths.js';

export type PreviewKind =
  | 'markdown'
  | 'text'
  | 'code'
  | 'image'
  | 'pdf'
  | 'html'
  | 'office'
  | 'binary';

export interface FileEntry {
  name: string;
  relPath: string;
  isDir: boolean;
  bytes: number;
  modifiedMs: number;
  kind: PreviewKind;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__',
  '.venv', 'venv', '.next', '.nuxt', 'coverage', '.cache', '.turbo', 'Pods',
]);

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const OFFICE = new Set(['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.odp', '.ods']);
const CODE = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.zsh',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.sql', '.graphql', '.proto',
  '.css', '.scss', '.vue', '.svelte', '.mjs',
]);
const TEXT = new Set(['.txt', '.log', '.csv', '.tsv', '.rst', '.adoc', '.env.example']);

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
};

export function classify(file: string): PreviewKind {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (IMAGE.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (OFFICE.has(ext)) return 'office';
  if (CODE.has(ext)) return 'code';
  if (TEXT.has(ext)) return 'text';
  return 'binary';
}

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function guardFor(workspaceRoot: string): PathGuard {
  return new PathGuard([workspaceRoot, hatsHome()]);
}

export async function listDirectory(
  workspaceRoot: string,
  relPath: string,
): Promise<{ path: string; parent: string | null; entries: FileEntry[] }> {
  const guard = guardFor(workspaceRoot);
  // Compare like with like: the guard returns realpaths, so the root must be one too or
  // every relative path climbs out through the symlink.
  const root = guard.resolve('.', workspaceRoot);
  const dir = guard.resolve(relPath || '.', root);
  const dirents = await fsp.readdir(dir, { withFileTypes: true });

  const entries: FileEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.') && d.name !== '.github') continue;
    if (d.isDirectory() && SKIP_DIRS.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) continue;
    entries.push({
      name: d.name,
      relPath: path.relative(root, abs),
      isDir: d.isDirectory(),
      bytes: stat.size,
      modifiedMs: stat.mtimeMs,
      kind: d.isDirectory() ? 'text' : classify(d.name),
    });
  }

  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const rel = path.relative(root, dir);
  return {
    path: rel || '.',
    parent: rel && rel !== '.' ? path.dirname(rel) : null,
    entries,
  };
}

export interface PreviewPayload {
  relPath: string;
  kind: PreviewKind;
  bytes: number;
  /** Present for text-ish kinds. */
  text?: string;
  truncated?: boolean;
  /** What to tell the user when we will not pretend to render it. */
  note?: string;
}

const MAX_TEXT_PREVIEW = 400_000;

export async function preview(workspaceRoot: string, relPath: string): Promise<PreviewPayload> {
  const guard = guardFor(workspaceRoot);
  const file = guard.resolve(relPath, workspaceRoot);
  const stat = await fsp.stat(file);
  if (stat.isDirectory()) throw new HatsError('TOOL_FAILED', 'that is a directory', { relPath });

  const kind = classify(file);
  const base: PreviewPayload = { relPath, kind, bytes: stat.size };

  if (kind === 'image' || kind === 'pdf' || kind === 'html') return base;

  if (kind === 'office') {
    return {
      ...base,
      note: `${path.extname(file)} files are zipped XML. Rendering one faithfully needs a real library, and a rough approximation would be worse than none — open it in the app that owns it.`,
    };
  }

  if (kind === 'binary') {
    return { ...base, note: 'Binary file. Nothing useful to show inline.' };
  }

  const raw = await fsp.readFile(file, 'utf8');
  const truncated = raw.length > MAX_TEXT_PREVIEW;
  return {
    ...base,
    text: truncated ? raw.slice(0, MAX_TEXT_PREVIEW) : raw,
    truncated,
  };
}

export async function readRaw(
  workspaceRoot: string,
  relPath: string,
): Promise<{ buffer: Buffer; mime: string }> {
  const guard = guardFor(workspaceRoot);
  const file = guard.resolve(relPath, workspaceRoot);
  return { buffer: await fsp.readFile(file), mime: mimeFor(file) };
}

/**
 * Reveal in the OS file manager. This spawns a process, so it is deliberately narrow:
 * a fixed binary per platform, the path passed as an argument rather than through a shell,
 * and the path guarded first. There is no code path here that runs anything user-supplied.
 */
export async function revealInFolder(workspaceRoot: string, relPath: string): Promise<string> {
  const guard = guardFor(workspaceRoot);
  const target = guard.resolve(relPath, workspaceRoot);
  await fsp.access(target);

  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === 'darwin') {
    command = 'open';
    args = ['-R', target];
  } else if (platform === 'win32') {
    command = 'explorer';
    args = [`/select,${target}`];
  } else {
    command = 'xdg-open';
    args = [path.dirname(target)];
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.on('error', reject);
    child.on('close', () => resolve());
  });
  return target;
}
