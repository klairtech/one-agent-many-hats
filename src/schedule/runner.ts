/**
 * The tick loop. Wakes every `TICK_MS`, asks each schedule whether it is owed a run, and
 * runs the ones that are through the unattended path in ADR-0007.
 *
 * Three things this has to get right beyond "fire on time":
 *
 *   - Two schedulers would fire everything twice. A pid lock makes the second one refuse
 *     rather than quietly double every scheduled run.
 *   - A schedule whose run takes longer than its interval would pile up. Each one runs at
 *     most once at a time; an overlapping firing is recorded as skipped, not queued.
 *   - A crashed run must not wedge the schedule forever, so `lastRunAt` is stamped before
 *     the run rather than after it.
 */

import { readFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';

import { HatsError, toHatsError } from '../core/errors.js';
import { Logger, flushAllLogs, runtimeLogger } from '../core/logger.js';
import { sweepAll } from '../core/retention.js';
import { schedulerLockPath } from '../core/paths.js';
import { ensureDir, exists } from '../core/store.js';
import { hatsHome } from '../core/paths.js';
import { runAgent, type RunResult } from '../engine/run.js';
import { openSession, type Session } from '../cli/session.js';
import {
  dueNow,
  getSchedule,
  listSchedules,
  saveSchedule,
  type ScheduleRecord,
} from './store.js';
import {
  summariseDecisions,
  unattendedApprover,
  unattendedAsker,
  type RemoteApprover,
  type Trigger,
  type UnattendedDecision,
} from './unattended.js';

const TICK_MS = 30_000;
/** Retention is a daily concern, not a per-tick one. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ScheduleOutcome {
  scheduleId: string;
  runId?: string;
  ok: boolean;
  answer: string;
  decisions: UnattendedDecision[];
  missed: number;
  error?: string;
}

export type OutcomeSink = (outcome: ScheduleOutcome, record: ScheduleRecord) => void | Promise<void>;

/**
 * How a scheduled run reaches a human mid-run. Supplied by whoever owns the channels —
 * the panel or `hats channel serve` — because the scheduler does not own them.
 */
export type ApproverSource = () => RemoteApprover | undefined;

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly inFlight = new Set<string>();
  private lockHeld = false;
  private stopped = false;
  private lastSweep = 0;

  constructor(
    private readonly logger: Logger = runtimeLogger('schedule'),
    private readonly onOutcome?: OutcomeSink,
    private readonly approverSource?: ApproverSource,
  ) {}

  /**
   * Takes the single-instance lock and starts ticking. Throws if another scheduler holds
   * the lock, so `hats schedule daemon` alongside a running panel says so instead of
   * silently doubling every run.
   */
  async start(): Promise<void> {
    await this.takeLock();
    this.stopped = false;
    // Deliberately not unref'd. This timer is the only thing holding a daemon's event loop
    // open — signal listeners and an unresolved promise do not — so unref'ing it made
    // `hats schedule daemon` print "scheduler running" and exit on the spot, having fired
    // nothing. The panel keeps itself open with its socket, so a ref'd timer costs it
    // nothing. [Found by watching a 1-minute schedule never fire, 2026-08-14.]
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.logger.info('scheduler.started', { tickMs: TICK_MS, pid: process.pid });
    // Retention runs off the daemon because the daemon is the thing that is always up.
    // A policy that only applies when someone opens the panel is not a policy.
    void this.sweep();
    await this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.logger.info('scheduler.stopped', { pid: process.pid });
    // Runtime records are queued and fire-and-forget, so a daemon that exits without this
    // loses whatever had not reached the disk yet — which is exactly the tail you want
    // after a shutdown you did not expect.
    await flushAllLogs();
    if (this.lockHeld) {
      await unlink(schedulerLockPath()).catch(() => undefined);
      this.lockHeld = false;
    }
  }

  /** One pass. Exposed so tests can drive it without waiting 30 seconds. */
  async tick(now = new Date()): Promise<ScheduleOutcome[]> {
    if (this.stopped) return [];
    // Self-throttled to once a day; safe to call on every tick.
    void this.sweep();
    let schedules: ScheduleRecord[];
    try {
      schedules = await listSchedules();
    } catch (e) {
      this.logger.warn('scheduler.schedules.unreadable', { code: toHatsError(e).code, error: toHatsError(e).message });
      return [];
    }

    const outcomes: ScheduleOutcome[] = [];
    for (const record of schedules) {
      let due: { due: boolean; missed: number };
      try {
        due = dueNow(record, now);
      } catch (e) {
        // A corrupt expression must not stop the other schedules from running.
        this.logger.warn('schedule.expression.invalid', {
          id: record.id,
          error: toHatsError(e).message,
        });
        continue;
      }
      if (!due.due) continue;

      if (this.inFlight.has(record.id)) {
        this.logger.warn('schedule.skipped.inflight', { scheduleId: record.id, workspace: record.workspace });
        await saveSchedule({ ...record, lastStatus: 'skipped' });
        continue;
      }
      outcomes.push(await this.fire(record, due.missed, now));
    }
    return outcomes;
  }

  /** Run one schedule now, regardless of whether it is due. Used by `hats schedule run`. */
  async runNow(id: string): Promise<ScheduleOutcome> {
    return this.fire(await getSchedule(id), 0, new Date());
  }

  private async fire(record: ScheduleRecord, missed: number, now: Date): Promise<ScheduleOutcome> {
    this.inFlight.add(record.id);
    // Stamped before the run: a crash mid-run must not leave the schedule permanently due,
    // firing again on every tick forever.
    await saveSchedule({ ...record, lastRunAt: now.toISOString(), missedRuns: missed });

    const decisions: UnattendedDecision[] = [];
    const trigger: Trigger = { kind: 'schedule', id: record.id, actor: record.author };
    let outcome: ScheduleOutcome;

    try {
      const result = await runUnattended({
        request: record.request,
        workspace: record.workspace,
        profile: record.profile,
        allowTools: record.allowTools,
        trigger,
        decisions,
        ...(this.approverSource?.() ? { askHuman: this.approverSource()! } : {}),
      });
      outcome = {
        scheduleId: record.id,
        runId: result.runId,
        ok: result.ok,
        answer: result.answer,
        decisions,
        missed,
      };
    } catch (e) {
      const err = toHatsError(e);
      outcome = {
        scheduleId: record.id,
        ok: false,
        answer: '',
        decisions,
        missed,
        error: `${err.code}: ${err.message}`,
      };
      this.logger.warn('schedule.run.failed', {
        scheduleId: record.id,
        workspace: record.workspace,
        code: err.code,
        error: err.message,
      });
    } finally {
      this.inFlight.delete(record.id);
    }

    const fresh = await getSchedule(record.id).catch(() => record);
    await saveSchedule({
      ...fresh,
      lastRunAt: now.toISOString(),
      missedRuns: missed,
      ...(outcome.runId ? { lastRunId: outcome.runId } : {}),
      lastStatus: outcome.ok ? 'ok' : 'failed',
      lastSummary: outcome.error ?? summarise(outcome),
    });

    if (this.onOutcome) {
      // A failing notifier must not fail the run that already happened.
      try {
        await this.onOutcome(outcome, record);
      } catch (e) {
        this.logger.warn('schedule.notify.failed', {
          scheduleId: record.id,
          code: toHatsError(e).code,
          error: toHatsError(e).message,
        });
      }
    }
    return outcome;
  }

  /**
   * Applies the retention policy, at most once a day.
   *
   * Deliberately fire-and-forget and deliberately quiet on failure: reclaiming disk must
   * never delay or fail a scheduled run. What it did is logged, including zero, so an
   * unexpectedly growing store is visible rather than something to be discovered later.
   */
  private async sweep(): Promise<void> {
    const since = Date.now() - this.lastSweep;
    if (this.lastSweep > 0 && since < SWEEP_INTERVAL_MS) return;
    this.lastSweep = Date.now();
    try {
      const result = await sweepAll();
      this.logger.info('retention.swept', {
        runsRemoved: result.runsRemoved,
        transcriptsRemoved: result.transcriptsRemoved,
        bytesReclaimed: result.bytesReclaimed,
        runtimeLogRotated: result.runtimeLogRotated,
        skipped: result.skipped,
      });
    } catch (e) {
      this.logger.warn('retention.sweep.failed', { error: toHatsError(e).message });
    }
  }

  private async takeLock(): Promise<void> {
    await ensureDir(hatsHome());
    const lock = schedulerLockPath();
    if (await exists(lock)) {
      const pid = Number(readFileSync(lock, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
        throw new HatsError(
          'CONFIG_INVALID',
          `a scheduler is already running (pid ${pid}). Two would fire every schedule twice.`,
          { lock, pid },
        );
      }
      // Stale lock from a killed process: taking it over is correct, and worth saying.
      this.logger.info('scheduler.lock.stale.cleared', { pid });
    }
    await writeFile(lock, String(process.pid), 'utf8');
    this.lockHeld = true;
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function summarise(outcome: ScheduleOutcome): string {
  const decisions = summariseDecisions(outcome.decisions);
  const head = outcome.answer.split('\n').find((l) => l.trim())?.slice(0, 200) ?? '';
  return decisions ? `${head} — ${decisions}` : head;
}

export interface UnattendedRunOptions {
  request: string;
  workspace: string;
  profile: ScheduleRecord['profile'];
  allowTools: string[];
  trigger: Trigger;
  decisions: UnattendedDecision[];
  session?: Session;
  /** Supplied when the human can be reached mid-run to approve something (ADR-0009). */
  askHuman?: RemoteApprover;
}

/**
 * The single entry point for a run with no human present. Both the scheduler and the
 * messaging channel call this — neither builds its own approve callback, which is what
 * keeps ADR-0007 enforceable in one place.
 */
export async function runUnattended(opts: UnattendedRunOptions): Promise<RunResult> {
  const session =
    opts.session ?? (await openSession({ workspace: opts.workspace, profile: opts.profile }));

  return runAgent({
    request: opts.request,
    workspaceRoot: session.workspaceRoot,
    config: session.config,
    registry: session.registry,
    pool: session.pool,
    memory: session.memory,
    documents: session.documents,
    profile: opts.profile,
    handlers: session.handlers,
    trigger: opts.trigger,
    approve: unattendedApprover(
      {
        profile: opts.profile,
        allowTools: opts.allowTools,
        trigger: opts.trigger,
        workspace: session.workspaceRoot,
        ...(opts.askHuman ? { askHuman: opts.askHuman } : {}),
      },
      opts.decisions,
    ),
    ask: unattendedAsker(),
  });
}
