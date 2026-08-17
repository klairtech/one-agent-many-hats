/**
 * Running a tool the agent wrote (ADR-0011).
 *
 * The spec of a built-in tool is a description of code we trust. The spec of a generated
 * tool is an *instruction to this file* about which flags to start it with, and that
 * inversion is the whole security argument: a handler that declared `mutating: false`
 * is spawned without `--allow-fs-write`, so the declaration is enforced by Node before the
 * code exists rather than believed by the executor afterwards.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

import { getCredential, readCredentials } from '../../core/credentials.js';
import { existsSync, readdirSync, realpathSync } from 'node:fs';

import { generatedToolsDir, packageRoot, toolDepsDir } from '../../core/paths.js';
import type { ToolHandler, ToolResult } from '../types.js';
import { readGeneratedCode, type GeneratedTool } from './store.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

function runnerPath(): string {
  return path.join(packageRoot(), 'runtime', 'generated-tool-runner.mjs');
}

interface RunnerReply {
  ok: boolean;
  summary?: string;
  payload?: unknown;
  failed?: boolean;
  error?: string;
  kind?: string;
}

/**
 * The flags a tool earns by what it declared. Nothing here reads the handler source: the
 * manifest is the only input, which is what makes the enforcement independent of how
 * cleverly the code is written.
 */
export function permissionFlags(tool: GeneratedTool, workspaceRoot: string): string[] {
  const flags = ['--permission'];
  // Read, never write. The shelf holds packages a person installed; a tool may import them
  // and may not change them, so a compromised handler cannot leave something behind on the
  // shelf for the next tool to import.
  //
  // Realpath'd first. Node compares resolved paths, and on macOS a temp or home directory
  // reaches the shelf through /var -> /private/var — so a grant written with the unresolved
  // path is a grant that never matches the file being opened.
  const shelf = existsSync(toolDepsDir()) ? realpathSync(toolDepsDir()) : '';
  if (shelf) flags.push(`--allow-fs-read=${shelf}/`);
  if (tool.mutating) {
    // Scoped to the workspace even when granted. A mutating tool is allowed to change the
    // user's project; it is not allowed to change the runtime that supervises it.
    const root = existsSync(workspaceRoot) ? realpathSync(workspaceRoot) : workspaceRoot;
    flags.push(`--allow-fs-read=${root}/`, `--allow-fs-write=${root}/`);
  }
  return flags;
}

/**
 * @param code  Supplied for a conversation-scoped tool, which is never written to disk —
 *              a one-off built to answer one question should not join the workspace's
 *              permanent tool list, where a later run would find it and wonder what it is.
 */
export function generatedHandler(tool: GeneratedTool, code?: string, dir?: string): ToolHandler {
  return {
    spec: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      mutating: tool.mutating,
      network: tool.network,
      minProfile: tool.minProfile,
      maxSummaryChars: 4_000,
    },

    async scopeFacts() {
      // So a standing grant can be scoped to "this agent-written tool" and an audit entry
      // says where the code came from without anyone opening the manifest.
      return { generated: true, writtenByRun: tool.writtenBy?.runId ?? 'unknown' };
    },

    async run(args, ctx): Promise<ToolResult> {
      // Its own directory, when the loader knew one. A tool can live on the device or in
      // the workspace, and looking only in the device directory made a workspace tool load
      // fine at startup and fail at its first call.
      const source = code ?? (await readGeneratedCode(tool.name, dir ? path.dirname(dir) : generatedToolsDir()));

      // Credentials cross into the child, never into the model. The tool named them in its
      // manifest when it was written, so the set is fixed at build time rather than chosen
      // per call by whatever the model decided to pass in.
      const credentials: Record<string, string> = {};
      const missing: string[] = [];
      for (const name of tool.credentials) {
        const value = getCredential(name);
        if (value) credentials[name] = value;
        else missing.push(name);
      }
      if (missing.length > 0) {
        // Name the credentials that *are* stored. The live failure this replaces: the run
        // collected the key as `api_key` and the tool declared it needed `orders_api_key`,
        // so it could never run — and the message only said "not stored yet", which sent
        // the agent back to ask for a key it had already been given. It asked, timed out,
        // and then called the same impossible tool five more times. Names only, never values.
        const held = Object.keys(readCredentials()).filter((k) => !k.includes('.'));
        return {
          summary:
            `${tool.name} needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not stored. ` +
            (held.length > 0
              ? `Stored right now: ${held.join(', ')}. If one of those is the same secret under a ` +
                `different name, rebuild the tool declaring that name — do not ask for it again. `
              : '') +
            `Otherwise collect it with ask_user using a field of type "secret" whose name matches ` +
            `exactly what the tool declares.`,
          failed: true,
        };
      }

      const reply = await runIsolated({
        code: source,
        args,
        facts: {
          workspaceRoot: ctx.workspaceRoot,
          profile: ctx.profile,
          credentials,
        },
        network: tool.network,
        workspaceRoot: ctx.workspaceRoot,
        tool,
      });

      if (!reply.ok) {
        return {
          summary: `${tool.name} failed (${reply.kind ?? 'error'}): ${reply.error ?? 'no detail'}`,
          failed: true,
          provenance: { generated: true, kind: reply.kind },
        };
      }

      return {
        summary: reply.summary || `${tool.name} returned no summary`,
        payload: reply.payload,
        ...(reply.failed ? { failed: true } : {}),
        provenance: { generated: true, writtenByRun: tool.writtenBy?.runId },
      };
    },
  };
}

function runIsolated(request: {
  code: string;
  args: Record<string, unknown>;
  facts: Record<string, unknown>;
  network: boolean;
  workspaceRoot: string;
  tool: GeneratedTool;
}): Promise<RunnerReply> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...permissionFlags(request.tool, request.workspaceRoot), '--no-warnings', runnerPath()],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        // A near-empty environment: the child gets the network switch and nothing else.
        // Inheriting the parent's env would hand every generated tool the user's shell
        // secrets, which is a larger grant than any of these tools asked for.
        env: {
          ...(request.network ? { HATS_TOOL_NETWORK: '1' } : {}),
          ...(existsSync(toolDepsDir())
            ? {
                HATS_TOOL_DEPS: realpathSync(toolDepsDir()),
                HATS_TOOL_DEPS_LIST: shelfPackages().join(', '),
              }
            : {}),
        },
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (reply: RunnerReply): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(reply);
    };

    // The parent owns the wall clock. A generated tool that hangs on a socket would
    // otherwise hold the run open for as long as the remote end feels like it.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `${request.tool.name} exceeded ${DEFAULT_TIMEOUT_MS}ms`, kind: 'timeout' });
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish({ ok: false, error: 'the tool wrote more than 512KB to stdout', kind: 'output' });
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (e) => {
      finish({ ok: false, error: `could not start ${request.tool.name}: ${e.message}`, kind: 'spawn' });
    });
    child.on('close', () => {
      if (settled) return;
      try {
        finish(JSON.parse(stdout) as RunnerReply);
      } catch {
        // A child that died before replying leaves only stderr, and that is the one place
        // a permission denial shows up as a stack rather than as our own error shape.
        finish({
          ok: false,
          error: stderr.trim().split('\n').slice(0, 4).join(' ') || 'the tool produced no output',
          kind: 'crash',
        });
      }
    });

    child.stdin.end(
      JSON.stringify({
        code: request.code,
        args: request.args,
        facts: request.facts,
        network: request.network,
      }),
    );
  });
}


/**
 * What is on the shelf right now.
 *
 * Read fresh rather than cached: a person installs a package and the very next run should
 * be able to use it, without restarting anything. Scoped packages are reported with their
 * scope so the name in the list is the name you would import.
 */
export function shelfPackages(root = toolDepsDir()): string[] {
  const modules = path.join(root, 'node_modules');
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(modules);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      try {
        for (const inner of readdirSync(path.join(modules, entry))) out.push(`${entry}/${inner}`);
      } catch {
        // An unreadable scope directory is not worth failing a tool call over.
      }
      continue;
    }
    out.push(entry);
  }
  return out.sort();
}
