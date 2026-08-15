/**
 * Does this tool load, and does it load under the permissions it asked for? (ADR-0011)
 *
 * Deliberately not a static analysis of the source. A regex over handler code is a speed
 * bump rather than a wall — `globalThis['fe'+'tch']` defeats it — and a check that can be
 * evaded is worse than no check at all, because it reads as protection. So the verification
 * is behavioural: start the thing the way it will really be started, and see what happens.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

import { packageRoot } from '../../core/paths.js';
import { permissionFlags } from './handler.js';
import type { GeneratedTool } from './store.js';

export interface SmokeResult {
  ok: boolean;
  stage: 'compile' | 'contract' | 'spawn' | 'timeout';
  detail: string;
}

const SMOKE_TIMEOUT_MS = 15_000;

/**
 * Import the handler in the real child, with the real flags, and confirm it exports `run`.
 *
 * It is not *called*: a connector's first act would be to open a socket to a service that
 * may not exist yet, and a tool must not have to be reachable to be installable. Loading is
 * what this proves — the module parses, its top level does not throw, and the contract the
 * runner depends on is satisfied.
 */
export async function smokeTest(
  tool: GeneratedTool,
  code: string,
  workspaceRoot: string,
): Promise<SmokeResult> {
  const probe = `${code}\n\nexport const __hats_probe = typeof run;\n`;

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        ...permissionFlags(tool, workspaceRoot),
        '--no-warnings',
        path.join(packageRoot(), 'runtime', 'generated-tool-runner.mjs'),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: tool.network ? { HATS_TOOL_NETWORK: '1', HATS_SMOKE: '1' } : { HATS_SMOKE: '1' },
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: SmokeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        ok: false,
        stage: 'timeout',
        detail: `the module did not finish loading within ${SMOKE_TIMEOUT_MS}ms — work at the top level of the module should move inside run()`,
      });
    }, SMOKE_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (e) => finish({ ok: false, stage: 'spawn', detail: e.message }));
    child.on('close', () => {
      if (settled) return;
      try {
        const reply = JSON.parse(stdout) as { ok: boolean; error?: string; kind?: string };
        if (reply.ok) return finish({ ok: true, stage: 'contract', detail: 'loads and exports run()' });
        finish({
          ok: false,
          stage: reply.kind === 'compile' ? 'compile' : 'contract',
          detail: reply.error ?? 'no detail',
        });
      } catch {
        finish({
          ok: false,
          stage: 'compile',
          detail: stderr.trim().split('\n').slice(0, 3).join(' ') || 'the module produced no output',
        });
      }
    });

    // HATS_SMOKE tells the runner to stop after the import and the export check rather than
    // calling run() with empty arguments, which for a connector means dialling a host.
    child.stdin.end(JSON.stringify({ code: probe, args: {}, facts: {}, network: tool.network }));
  });
}
