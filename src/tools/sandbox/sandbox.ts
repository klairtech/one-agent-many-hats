/**
 * The sandbox tool: generate -> execute -> validate (paper §3).
 *
 * The three steps stay separate and separately audited. The model's *intent* (the task
 * descriptor and the code) is recorded before anything runs, the execution is isolated
 * (ADR-0004), and the output is validated before it may be cited. Sandbox output is
 * evidence, never narrative: it extends what the agent can compute, not what it can
 * assert.
 */

import { spawn } from 'node:child_process';

import { HatsError } from '../../core/errors.js';
import { sandboxRunnerPath } from '../../core/paths.js';
import type { ToolHandler, ToolResult } from '../types.js';

interface RunnerReply {
  ok: boolean;
  result?: unknown;
  logs?: string[];
  error?: string;
  kind?: string;
}

export const sandboxRun: ToolHandler = {
  spec: {
    name: 'sandbox_run',
    description:
      'Run a short JavaScript snippet against artifacts from this run, when no named tool fits the computation. The snippet runs isolated: no network, no filesystem, no imports, no clock, no randomness. Inside it you have load_artifact(id), artifact_ids(), lookup(rows, {field: value}), sum(rows, field) and log(...). End with `return <object>`. Prefer derive_metric when it fits — code is the last resort.',
    parameters: {
      type: 'object',
      properties: {
        task_descriptor: {
          type: 'string',
          description:
            'What this computation is, in a few words, e.g. "weighted margin bridge". Recurring descriptors become candidates for a real tool.',
        },
        code: {
          type: 'string',
          description: 'The snippet. Must end with a `return` of a JSON-serialisable object.',
        },
        artifact_ids: {
          type: 'array',
          description: 'Artifacts to bind, by id. Only these are visible to the snippet.',
          items: { type: 'string' },
        },
        expect: {
          type: 'string',
          enum: ['object', 'array', 'number'],
          description: 'The shape you expect back. Validation fails the call if it differs.',
        },
      },
      required: ['task_descriptor', 'code'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const descriptor = String(args['task_descriptor']);
    const code = String(args['code']);
    const ids = Array.isArray(args['artifact_ids']) ? (args['artifact_ids'] as string[]).map(String) : [];
    const expect = args['expect'] ? String(args['expect']) : undefined;

    // --- step 1: generate. Intent is recorded before anything executes. ---
    ctx.recordTaskDescriptor(descriptor);
    ctx.logger.info('sandbox.generate', {
      descriptor,
      codeChars: code.length,
      artifacts: ids,
      runId: ctx.runId,
    });

    const bound: Record<string, unknown> = {};
    for (const id of ids) {
      const artifact = await ctx.artifacts.get(id);
      if (!artifact) {
        throw new HatsError(
          'TOOL_INPUT_INVALID',
          `no artifact "${id}" in this run — bind ids you received from earlier observations`,
          { id },
        );
      }
      bound[id] = artifact.payload;
    }

    // --- step 2: execute, isolated. ---
    const started = Date.now();
    const reply = await runIsolated(
      {
        code,
        artifacts: bound,
        timeoutMs: ctx.config.sandbox.timeoutMs,
        maxOutputBytes: ctx.config.sandbox.maxOutputBytes,
      },
      ctx.config.sandbox.memoryMb,
    );
    const durationMs = Date.now() - started;

    if (!reply.ok) {
      ctx.logger.warn('sandbox.failed', { descriptor, error: reply.error, durationMs });
      return {
        summary: `sandbox ${reply.kind === 'timeout' ? 'timed out' : 'failed'}: ${reply.error}\nFix the snippet or fall back to named tools. Do not cite anything from this attempt.`,
        payload: { descriptor, code, error: reply.error },
        provenance: { descriptor, artifacts: ids },
        failed: true,
      };
    }

    // --- step 3: validate. Nothing may be cited before this passes. ---
    const problem = validateOutput(reply.result, expect);
    if (problem) {
      ctx.logger.warn('sandbox.invalid', { descriptor, problem });
      return {
        summary: `sandbox output rejected: ${problem}\nThe values are not usable as evidence. Recompute or report the gap honestly.`,
        payload: { descriptor, code, result: reply.result },
        provenance: { descriptor, artifacts: ids },
        failed: true,
      };
    }

    const artifact = await ctx.artifacts.put({
      kind: 'sandbox',
      tool: 'sandbox_run',
      summary: `${descriptor}: ${preview(reply.result)}`,
      payload: reply.result,
      provenance: { descriptor, code, artifacts: ids, durationMs, validated: true },
    });

    ctx.logger.info('sandbox.validated', { descriptor, artifactId: artifact.id, durationMs });

    const logs = (reply.logs ?? []).slice(0, 20);
    return {
      summary:
        `${descriptor} -> ${JSON.stringify(reply.result).slice(0, 2_000)}` +
        (logs.length > 0 ? `\nlogs:\n${logs.join('\n')}` : ''),
      artifactId: artifact.id,
      payload: reply.result,
    };
  },
};

async function runIsolated(
  request: { code: string; artifacts: Record<string, unknown>; timeoutMs: number; maxOutputBytes: number },
  memoryMb: number,
): Promise<RunnerReply> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        // Layer 2 (ADR-0004): no filesystem, no subprocess, no worker, no native addons.
        '--permission',
        `--max-old-space-size=${Math.max(32, memoryMb)}`,
        '--no-warnings',
        sandboxRunnerPath(),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], env: {} },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    // Layer 1: the parent owns the wall clock. The VM timeout is the inner cap; this is
    // the outer one, and it covers a child that never reaches the VM at all.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, error: `sandbox exceeded ${request.timeoutMs}ms`, kind: 'timeout' });
    }, request.timeoutMs + 2_000);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `could not start the sandbox: ${e.message}` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!stdout.trim()) {
        resolve({
          ok: false,
          error: `sandbox exited ${code} with no output${stderr ? `: ${stderr.slice(0, 500)}` : ''}`,
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as RunnerReply);
      } catch {
        resolve({ ok: false, error: `unparseable sandbox reply: ${stdout.slice(0, 300)}` });
      }
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

/** Shape, finiteness and size. A result that fails any of these is not evidence. */
export function validateOutput(result: unknown, expect?: string): string | null {
  if (result === null || result === undefined) {
    return 'the snippet returned nothing — end it with `return <object>`';
  }
  if (expect === 'object' && (typeof result !== 'object' || Array.isArray(result))) {
    return `expected an object, got ${Array.isArray(result) ? 'an array' : typeof result}`;
  }
  if (expect === 'array' && !Array.isArray(result)) {
    return `expected an array, got ${typeof result}`;
  }
  if (expect === 'number' && typeof result !== 'number') {
    return `expected a number, got ${typeof result}`;
  }

  const bad = findNonFinite(result, 0);
  if (bad) return `contains a non-finite number at ${bad}`;

  if (typeof result === 'object' && Object.keys(result as object).length === 0) {
    return 'the result is empty — an empty object is not evidence';
  }
  return null;
}

function findNonFinite(value: unknown, depth: number, path = '$'): string | null {
  if (depth > 8) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findNonFinite(value[i], depth + 1, `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const found = findNonFinite(v, depth + 1, `${path}.${k}`);
      if (found) return found;
    }
  }
  return null;
}

function preview(value: unknown): string {
  const json = JSON.stringify(value);
  return json.length > 300 ? `${json.slice(0, 300)}…` : json;
}

export const sandboxTools: ToolHandler[] = [sandboxRun];
