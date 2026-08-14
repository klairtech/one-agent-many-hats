/**
 * Structured JSONL logging. REPO_RULES §5: one event per line, always
 * `{ ts, level, event, ... }`. Library code never calls console.log; human-facing
 * output goes through src/cli/render.ts.
 *
 * Two sinks with different jobs:
 *  - the run's audit.jsonl — the record of what the agent did, kept forever
 *  - stderr — only when HATS_DEBUG is set, for developing the runtime itself
 */

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

function debugEnabled(): boolean {
  const v = process.env['HATS_DEBUG'];
  return !!v && v !== '0' && v !== 'false';
}

export class Logger {
  private readonly sinkFile: string | undefined;
  private readonly base: Record<string, unknown>;
  private readonly minLevel: LogLevel;
  /** Fire-and-forget writes are chained so lines cannot interleave mid-line. */
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: { file?: string; base?: Record<string, unknown>; minLevel?: LogLevel } = {}) {
    this.sinkFile = opts.file;
    this.base = opts.base ?? {};
    this.minLevel = opts.minLevel ?? 'info';
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
    const record: LogEvent = {
      ts: new Date().toISOString(),
      level,
      event,
      ...this.base,
      ...fields,
    };
    if (debugEnabled()) {
      process.stderr.write(`[hats] ${JSON.stringify(record)}\n`);
    }
    if (this.sinkFile) {
      const file = this.sinkFile;
      this.queue = this.queue.then(() => appendJsonl(file, record)).catch(() => {
        /* the audit sink must never take the run down; debug sink shows the loss */
        if (debugEnabled()) process.stderr.write('[hats] audit write failed\n');
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

  /** Await pending writes — call before exit so the audit trail is complete. */
  async flush(): Promise<void> {
    await this.queue;
  }
}

export const nullLogger = new Logger({ minLevel: 'error' });
