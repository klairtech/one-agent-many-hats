/**
 * Tools the agent wrote itself: on disk, and back again (ADR-0011).
 *
 * One directory per tool under `~/.hats/tools`, holding the manifest and the handler
 * source as separate files. Separate on purpose — the handler is code a person may want to
 * read or diff, and burying it as a JSON string turns every newline into `\n` and makes it
 * unreadable exactly when someone is trying to work out what the agent built.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

import { HatsError } from '../../core/errors.js';
import { generatedToolsDir } from '../../core/paths.js';
import type { JsonSchema } from '../../providers/types.js';

export interface GeneratedTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Declared by the agent, enforced by the flags the runner derives from it. */
  mutating: boolean;
  network: boolean;
  minProfile: 'read-only' | 'assisted' | 'trusted';
  /**
   * Credential names this tool reads. The values are passed to the child process and never
   * to the model — a connector needs the key, the model needs to know it exists.
   */
  credentials: string[];
  /** Why it exists, in the words of the run that wrote it. */
  rationale: string;
  /** Provenance: nothing here was written by a person, and the record should say so. */
  writtenBy: { runId: string; at: string; model?: string };
}

/** Reserved words and shapes that would collide with the executor's own vocabulary. */
const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function assertUsableName(name: string, taken: Iterable<string>): void {
  if (!NAME.test(name)) {
    throw new HatsError(
      'TOOL_INPUT_INVALID',
      `"${name}" is not a usable tool name: lowercase snake_case, starting with a letter`,
      { name },
    );
  }
  if (name.length > 40) {
    throw new HatsError('TOOL_INPUT_INVALID', `"${name}" is too long for a tool name`, { name });
  }
  for (const existing of taken) {
    if (existing === name) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `a tool named "${name}" already exists. Patch that one with propose_patch rather ` +
          `than shadowing it — two tools with one name is a coin flip at call time.`,
        { name },
      );
    }
  }
}

function dirFor(name: string, root: string): string {
  return path.join(root, name);
}

export async function writeGeneratedTool(
  tool: GeneratedTool,
  code: string,
  root = generatedToolsDir(),
): Promise<string> {
  const dir = dirFor(tool.name, root);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'tool.json'), `${JSON.stringify(tool, null, 2)}\n`, 'utf8');
  await fsp.writeFile(path.join(dir, 'handler.mjs'), code.endsWith('\n') ? code : `${code}\n`, 'utf8');
  return dir;
}

export async function readGeneratedCode(name: string, root = generatedToolsDir()): Promise<string> {
  return fsp.readFile(path.join(dirFor(name, root), 'handler.mjs'), 'utf8');
}

export async function removeGeneratedTool(name: string, root = generatedToolsDir()): Promise<void> {
  await fsp.rm(dirFor(name, root), { recursive: true, force: true });
}

/**
 * Everything currently installed. A directory that does not parse is skipped rather than
 * thrown: one malformed tool must not stop the runtime from starting, or a bad generation
 * locks the user out of the panel they would use to delete it.
 */
export async function listGeneratedTools(
  root = generatedToolsDir(),
): Promise<Array<{ tool: GeneratedTool; dir: string }>> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const found: Array<{ tool: GeneratedTool; dir: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      const raw = await fsp.readFile(path.join(dir, 'tool.json'), 'utf8');
      const tool = JSON.parse(raw) as GeneratedTool;
      if (!tool?.name || !NAME.test(tool.name)) continue;
      // A manifest whose name does not match its directory would let one tool masquerade
      // as another after a rename, so the directory is the authority.
      if (tool.name !== entry.name) continue;
      found.push({ tool: normalise(tool), dir });
    } catch {
      continue;
    }
  }
  return found.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
}

/** Missing fields default to the least authority, never the most. */
function normalise(tool: GeneratedTool): GeneratedTool {
  return {
    ...tool,
    mutating: tool.mutating === true,
    network: tool.network === true,
    minProfile:
      tool.minProfile === 'trusted' || tool.minProfile === 'assisted' ? tool.minProfile : 'read-only',
    credentials: Array.isArray(tool.credentials) ? tool.credentials.map(String) : [],
    // Not `?? {}`: an empty object is the shape that got through before, and a provider
    // refuses it with "input_schema.type: Field required" — failing every tool in the
    // request, not just this one.
    parameters: usableSchema(tool.parameters),
  };
}

/** A schema a provider will accept, whatever the manifest happens to contain. */
function usableSchema(raw: unknown): JsonSchema {
  const schema = (raw && typeof raw === 'object' ? { ...(raw as JsonSchema) } : {}) as JsonSchema;
  if (schema.type !== 'object') schema.type = 'object';
  if (!schema.properties || typeof schema.properties !== 'object') schema.properties = {};
  return schema;
}
