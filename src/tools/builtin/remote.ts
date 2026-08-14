/**
 * Running a command on a machine that is not this one.
 *
 * This is the tool behind "watch the server overnight and fix it". It shells out to the
 * system `ssh`, which is the right call rather than a limitation: the user's existing
 * config, keys, agent, jump hosts and `known_hosts` all work, and there is no second
 * implementation of an SSH client to get wrong.
 *
 * Three constraints, all of them because this reaches off the machine:
 *   - the host must be in `config.remote.hosts`. The agent cannot name a new one.
 *   - key-based auth only. `BatchMode=yes` makes ssh fail rather than sit at a prompt,
 *     and no password is ever read, stored or typed.
 *   - it is mutating, so it needs approval or a standing grant scoped to the host.
 */

import { spawn } from 'node:child_process';

import { HatsError } from '../../core/errors.js';
import type { ToolHandler, ToolResult } from '../types.js';

/** Long enough for a package install, short enough that a hung session ends the step. */
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 200_000;

export const sshRun: ToolHandler = {
  spec: {
    name: 'ssh_run',
    description:
      'Run a shell command on a configured remote host over SSH and return its stdout, stderr and exit code. Only hosts the user has configured can be reached. Use it to inspect a server (logs, disk, service status) and, where permitted, to act on one.',
    parameters: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'The configured host alias to run on. Must already be configured.',
        },
        command: {
          type: 'string',
          description:
            'The command line to run on the remote host. Runs non-interactively — anything that prompts will hang and then time out.',
        },
        timeout_ms: { type: 'number', description: 'Wall-clock cap. Defaults to 120000.' },
      },
      required: ['host', 'command'],
    },
    mutating: true,
    network: true,
    minProfile: 'assisted',
  },

  async run(args, ctx): Promise<ToolResult> {
    const hosts = ctx.config.remote?.hosts ?? {};
    const alias = String(args['host'] ?? '').trim();
    const conf = hosts[alias];
    if (!conf) {
      // Naming an unconfigured host is refused rather than attempted: the allowlist is the
      // boundary, and a helpful "did you mean" that tried the connection would not be one.
      throw new HatsError(
        'TOOL_NOT_ALLOWED',
        `"${alias}" is not a configured host. The user configures these; you cannot add one.`,
        { configured: Object.keys(hosts) },
        'rule/network-off-by-default',
      );
    }
    if (!ctx.config.network.enabled) {
      throw new HatsError(
        'NETWORK_DENIED',
        'ssh_run needs tool network egress, which is off',
        {},
        'rule/network-off-by-default',
      );
    }

    const command = String(args['command'] ?? '').trim();
    if (!command) throw new HatsError('TOOL_INPUT_INVALID', 'ssh_run needs a command', {});

    const target = conf.user ? `${conf.user}@${conf.hostname}` : conf.hostname;
    const sshArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `ConnectTimeout=${Math.ceil((conf.connectTimeoutMs ?? 15_000) / 1000)}`,
      ...(conf.port ? ['-p', String(conf.port)] : []),
      ...(conf.identityFile ? ['-i', conf.identityFile] : []),
      ...(conf.options ?? []).flatMap((o) => ['-o', o]),
      target,
      command,
    ];

    // Recorded before it runs. A command that takes the box down still leaves a record of
    // what was about to happen.
    ctx.logger.warn('ssh.command.pending', { host: alias, target, command: command.slice(0, 2_000) });

    const timeoutMs = Number(args['timeout_ms'] ?? DEFAULT_TIMEOUT_MS);
    const result = await execute('ssh', sshArgs, timeoutMs, ctx.signal);

    const summary =
      `${alias} ($ ${command})\nexit ${result.code}` +
      (result.stdout ? `\n--- stdout ---\n${result.stdout}` : '') +
      (result.stderr ? `\n--- stderr ---\n${result.stderr}` : '') +
      (result.timedOut ? `\n(timed out after ${timeoutMs}ms)` : '');

    return {
      summary,
      payload: {
        host: alias,
        target,
        command,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      },
      provenance: { host: alias, target },
      // A non-zero exit is information, not a crash: the model should reason about it.
      failed: result.code !== 0,
    };
  },
};

function execute(
  bin: string,
  argv: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // ssh missing is a setup problem, and saying so beats "exit 127".
      resolve({ code: 127, stdout, stderr: `${stderr}\ncould not start ssh: ${e.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: code ?? -1, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), timedOut });
    });
  });
}

export const remoteTools: ToolHandler[] = [sshRun];
