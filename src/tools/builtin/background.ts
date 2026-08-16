/**
 * Commands that outlive the step that started them.
 *
 * `run_command` waits, which is right for `git status` and wrong for everything that takes
 * real time: a test suite, a build, a dev server you want to point the browser at. The cap
 * is ten minutes, and a run that hit it got a TIMEOUT and no output — the work had happened
 * and every trace of it was thrown away.
 *
 * So: start it, get a handle, do something else, come back for the output. Three tools,
 * because they are three decisions — start, look, stop — and folding "look" into "start"
 * is what made the blocking version unable to help.
 *
 * The registry is deliberately in memory and process-scoped. A handle is only meaningful
 * while the thing it names is running, and a handle that survives the runtime points at a
 * process that does not exist.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { HatsError } from '../../core/errors.js';
import { shapeText } from '../artifacts.js';
import type { ToolHandler, ToolResult } from '../types.js';

/** Per stream, per job. Enough for a test suite's failures, short of eating the heap. */
const MAX_BUFFER = 400_000;

interface Job {
  id: string;
  command: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  /** Bytes dropped once the buffer filled, so truncation is reported rather than hidden. */
  dropped: number;
  startedAt: number;
  exitCode: number | null;
  finishedAt: number | null;
  killed: boolean;
  /** How much of each stream has already been handed to the model. */
  read: { stdout: number; stderr: number };
}

const jobs = new Map<string, Job>();

/**
 * Signal the whole group, falling back to the child alone.
 *
 * A negative pid means "the process group" on POSIX. It is the difference between stopping
 * a command and stopping the first process of one.
 */
function signal(job: Job, sig: NodeJS.Signals): void {
  try {
    if (job.child.pid) process.kill(-job.child.pid, sig);
    else job.child.kill(sig);
  } catch {
    // The group is already gone, or this platform has no groups. Either way, try the child
    // directly and accept that a process which has already exited cannot be signalled.
    try {
      job.child.kill(sig);
    } catch {
      // Nothing left to signal.
    }
  }
}

/**
 * Nothing we started outlives us. A dev server left running after the runtime exits is a
 * port nobody can free and a process nobody remembers starting.
 */
let cleanupBound = false;
function bindCleanup(): void {
  if (cleanupBound) return;
  cleanupBound = true;
  const killAll = () => {
    for (const job of jobs.values()) {
      if (job.exitCode === null) signal(job, 'SIGKILL');
    }
  };
  process.once('exit', killAll);
  process.once('SIGINT', killAll);
  process.once('SIGTERM', killAll);
}

export function startBackgroundCommand(command: string, cwd: string, runId: string): Job {
  bindCleanup();
  const child = spawn(command, {
    shell: true,
    cwd,
    env: { ...process.env, HATS_RUN_ID: runId },
    // Its own process group, so stopping it stops what it started. Without this we signal
    // the shell and nothing else: `npm run dev` is npm, which forks node, and killing npm
    // leaves node holding the port with no handle left to reach it by.
    detached: true,
  });

  const job: Job = {
    id: `job_${randomBytes(4).toString('hex')}`,
    command,
    child,
    stdout: '',
    stderr: '',
    dropped: 0,
    startedAt: Date.now(),
    exitCode: null,
    finishedAt: null,
    killed: false,
    read: { stdout: 0, stderr: 0 },
  };

  const collect = (stream: 'stdout' | 'stderr') => (d: Buffer) => {
    const text = d.toString('utf8');
    if (job[stream].length + text.length > MAX_BUFFER) {
      job.dropped += text.length;
      return;
    }
    job[stream] += text;
  };
  child.stdout?.on('data', collect('stdout'));
  child.stderr?.on('data', collect('stderr'));
  child.on('error', (e) => {
    job.stderr += `\n${e.message}`;
    job.exitCode = job.exitCode ?? -1;
    job.finishedAt = Date.now();
  });
  child.on('close', (code) => {
    job.exitCode = code ?? -1;
    job.finishedAt = Date.now();
  });

  jobs.set(job.id, job);
  return job;
}

function get(id: string): Job {
  const job = jobs.get(id);
  if (!job) {
    const live = [...jobs.values()].filter((j) => j.exitCode === null).map((j) => j.id);
    throw new HatsError(
      'TOOL_INPUT_INVALID',
      `no background command with id "${id}". ` +
        (live.length ? `Still running: ${live.join(', ')}.` : 'Nothing is running.'),
      { id },
    );
  }
  return job;
}

function status(job: Job): string {
  if (job.exitCode === null) return `running for ${Math.round((Date.now() - job.startedAt) / 1000)}s`;
  return `exited ${job.exitCode} after ${Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000)}s`;
}

export const commandOutput: ToolHandler = {
  spec: {
    name: 'command_output',
    description:
      'Read what a background command has printed since you last looked, and whether it has finished. Call it again for more — each call returns only what is new, so polling a build does not re-read the whole log every time. A command you started and never read is a command whose result you cannot honestly report.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id run_command returned when you started it.' },
        from_start: {
          type: 'boolean',
          description: 'Return everything it has printed rather than only what is new. Default false.',
        },
      },
      required: ['id'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const job = get(String(args['id']));
    const all = args['from_start'] === true;
    const out = all ? job.stdout : job.stdout.slice(job.read.stdout);
    const err = all ? job.stderr : job.stderr.slice(job.read.stderr);
    job.read = { stdout: job.stdout.length, stderr: job.stderr.length };

    const body = [out.trim(), err.trim() ? `stderr:\n${err.trim()}` : ''].filter(Boolean).join('\n');
    const head = shapeText(body, ctx.config.limits.maxToolOutputChars, 'Full output is in the artifact.');
    const note = job.dropped > 0 ? ` (${job.dropped} characters were dropped: the buffer is full)` : '';

    return {
      summary:
        `${job.id} — ${status(job)}${note}\n` +
        (head.summary || (all ? '(no output at all)' : '(nothing new since the last look)')),
      payload: { id: job.id, command: job.command, running: job.exitCode === null, exitCode: job.exitCode, stdout: out, stderr: err },
      provenance: { id: job.id, command: job.command },
      // A command still running is not a failure. A finished one that exited non-zero is.
      failed: job.exitCode !== null && job.exitCode !== 0,
    };
  },
};

export const stopCommand: ToolHandler = {
  spec: {
    name: 'stop_command',
    description:
      'Stop a background command you started. Use it when you have what you needed from a long job, and always for a server you started — it does not stop on its own.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The id run_command returned.' } },
      required: ['id'],
    },
    mutating: true,
    network: false,
    minProfile: 'assisted',
  },

  async run(args): Promise<ToolResult> {
    const job = get(String(args['id']));
    if (job.exitCode !== null) {
      return {
        summary: `${job.id} had already ${status(job)}; nothing to stop.`,
        payload: { id: job.id, exitCode: job.exitCode },
      };
    }
    job.killed = true;
    signal(job, 'SIGTERM');
    // SIGTERM is a request. Anything that ignores it gets one grace period and then does not
    // get a choice, because a job nobody can stop is a job that outlives the runtime.
    setTimeout(() => {
      if (job.exitCode === null) signal(job, 'SIGKILL');
    }, 1_500).unref();

    return {
      summary: `stopped ${job.id} (${job.command})`,
      payload: { id: job.id, stopped: true },
      provenance: { id: job.id, command: job.command },
    };
  },
};

/** For the completion check: work that was started and never looked at. */
export function unreadBackgroundJobs(): Array<{ id: string; command: string; running: boolean }> {
  return [...jobs.values()]
    .filter((j) => j.read.stdout === 0 && j.read.stderr === 0)
    .map((j) => ({ id: j.id, command: j.command, running: j.exitCode === null }));
}

/** Tests need a clean slate; nothing else should call this. */
export function resetBackgroundJobs(): void {
  for (const job of jobs.values()) signal(job, 'SIGKILL');
  jobs.clear();
}
