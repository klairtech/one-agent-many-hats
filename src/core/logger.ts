/**
 * Structured JSONL logging. REPO_RULES §5: one event per line, always
 * `{ ts, level, event, ... }`. Library code never calls console.log; human-facing
 * output goes through src/cli/render.ts.
 *
 * Sinks, and what each is for:
 *  - the run's `audit.jsonl` — the detailed record of one run, written by the engine
 *  - `$HATS_HOME/logs/runtime.jsonl` — everything that happens outside a run: the
 *    scheduler, channels, approvals, MCP, memory. Before this existed those components
 *    held Loggers with no file at all, so ~28 emit sites went nowhere unless HATS_DEBUG
 *    happened to be set. The unattended path was the least observed part of the system,
 *    which is precisely backwards.
 *  - stderr — only when HATS_DEBUG is set, for developing the runtime itself.
 *
 * The accountability record is a different stream with different rules; see
 * `src/core/audit.ts`. Do not add audit events here.
 *
 * Two invariants this module owns:
 *  - **Every record is redacted before it reaches any sink**, including stderr. Filtering
 *    on read cannot undo a secret that is already in a file someone backs up.
 *  - **Emission never takes the run down.** Writes are queued, the queue is bounded, and
 *    a failing or saturated sink drops records and counts the loss rather than blocking
 *    the caller or throwing.
 */

import path from 'node:path';

import { redactFields, redactString } from './redact.js';
import { currentContext } from './context.js';
import { hatsHome } from './paths.js';
import { appendJsonl } from './store.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  ts: string;
  level: LogLevel;
  event: string;
  runId?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * How many writes may be in flight before records are dropped. A backed-up disk must cost
 * telemetry, never the run — but the loss has to be visible, so it is counted and reported
 * by `droppedRecords()` rather than being silent.
 */
const MAX_PENDING = 1_000;

let dropped = 0;

/** Records discarded because a sink could not keep up. Non-zero means the log is partial. */
export function droppedRecords(): number {
  return dropped;
}

function debugEnabled(): boolean {
  const v = process.env['HATS_DEBUG'];
  return !!v && v !== '0' && v !== 'false';
}

/** Every logger holding a file sink, so a process can flush all of them before exit. */
const withSinks = new Set<Logger>();

export class Logger {
  private readonly sinkFile: string | undefined;
  private readonly base: Record<string, unknown>;
  private readonly minLevel: LogLevel;
  /** Fire-and-forget writes are chained so lines cannot interleave mid-line. */
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(opts: { file?: string; base?: Record<string, unknown>; minLevel?: LogLevel } = {}) {
    this.sinkFile = opts.file;
    this.base = opts.base ?? {};
    this.minLevel = opts.minLevel ?? 'info';
    if (this.sinkFile) withSinks.add(this);
  }

  child(extra: Record<string, unknown>, file?: string): Logger {
    return new Logger({
      file: file ?? this.sinkFile,
      base: { ...this.base, ...extra },
      minLevel: this.minLevel,
    });
  }

  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    // HATS_DEBUG lowers the floor to everything; otherwise honour minLevel.
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel] && !debugEnabled()) return;
    // Redaction happens once, here, covering the caller's fields and the base context —
    // a workspace path or a channel identity in `base` is just as much a leak as an
    // argument. `ts`/`level`/`event` are assembled afterwards because they are set by the
    // runtime, never by a caller, and must stay exactly queryable.
    // Ambient identifiers first, so every record carries runId/workspace/actor/step even
    // when the caller is a module that has never heard of them — the HTTP layer emitting a
    // retry is the case this exists for. An explicitly passed field always wins.
    const record: LogEvent = {
      ts: new Date().toISOString(),
      level,
      event: redactString(event),
      ...redactFields({ ...currentContext(), ...this.base, ...fields }),
    };
    if (debugEnabled()) {
      process.stderr.write(`[hats] ${JSON.stringify(record)}\n`);
    }
    if (this.sinkFile) {
      if (this.pending >= MAX_PENDING) {
        dropped++;
        return;
      }
      const file = this.sinkFile;
      this.pending++;
      this.queue = this.queue
        .then(() => appendJsonl(file, record))
        .catch(() => {
          /* the sink must never take the run down; the loss is counted, not thrown */
          dropped++;
          if (debugEnabled()) process.stderr.write('[hats] log write failed\n');
        })
        .finally(() => {
          this.pending--;
        });
    }
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.log('debug', event, fields);
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.log('info', event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.log('warn', event, fields);
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.log('error', event, fields);
  }

  /** Await pending writes — call before exit so the trail is complete. */
  async flush(): Promise<void> {
    await this.queue;
  }
}

/** Flush every file-backed logger. Used on shutdown paths where records would be lost. */
export async function flushAllLogs(): Promise<void> {
  await Promise.allSettled([...withSinks].map((l) => l.flush()));
}

/** The runtime log: everything happening outside a single run. */
export function runtimeLogPath(): string {
  return path.join(hatsHome(), 'logs', 'runtime.jsonl');
}

/**
 * A logger for a long-lived component (scheduler, channel, approvals, session).
 *
 * `component` is a stable field rather than part of the event name, so one query can ask
 * "everything the scheduler did" without knowing which events the scheduler emits.
 */
export function runtimeLogger(component: string, base: Record<string, unknown> = {}): Logger {
  return new Logger({
    file: runtimeLogPath(),
    base: { component, ...base },
    minLevel: 'info',
  });
}

export const nullLogger = new Logger({ minLevel: 'error' });
