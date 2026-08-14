/**
 * A five-field cron parser, plus the shorthands people actually type.
 *
 * Written rather than depended on, per REPO_RULES §2 (zero runtime dependencies), and it
 * is a smaller thing to write than to audit.
 *
 * The one design decision worth stating: next-fire is computed by walking local wall-clock
 * minutes and testing the fields, not by adding milliseconds to an epoch. "Every morning at
 * seven" means seven on the clock on the wall, and on the two days a year when a timezone
 * shifts, epoch arithmetic gets that wrong by an hour — silently, twice a year, in a
 * scheduler nobody is watching. Walking wall-clock fields is slower and correct. The walk
 * is bounded, so an unsatisfiable expression (31 February) returns null instead of looping.
 */

import { HatsError } from '../core/errors.js';

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Both day fields restricted: cron's historical OR rather than AND. */
  bothDayFields: boolean;
}

export type Schedule =
  | { kind: 'cron'; expression: string; fields: CronFields }
  /** `@every 15m` — fixed spacing from the last fire, not aligned to the clock. */
  | { kind: 'every'; expression: string; ms: number };

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const SHORTHANDS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

/** Longest gap the walk will search before declaring an expression unsatisfiable. */
const SEARCH_LIMIT_MINUTES = 366 * 24 * 60;

export function parseSchedule(input: string): Schedule {
  const raw = input.trim().toLowerCase();
  if (!raw) throw new HatsError('CONFIG_INVALID', 'schedule expression is empty', {});

  const every = /^@every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/.exec(raw);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2] as string;
    const ms = n * (unit.startsWith('d') ? 86_400_000 : unit.startsWith('h') ? 3_600_000 : 60_000);
    if (n <= 0) throw new HatsError('CONFIG_INVALID', `"${input}": interval must be above zero`, {});
    // Below a minute the tick loop cannot honour it, so it would silently become 60s.
    if (ms < 60_000) {
      throw new HatsError('CONFIG_INVALID', `"${input}": the shortest interval is 1 minute`, {});
    }
    return { kind: 'every', expression: raw, ms };
  }

  const expanded = SHORTHANDS[raw] ?? raw;
  if (expanded.startsWith('@')) {
    throw new HatsError('CONFIG_INVALID', `unknown shorthand "${input}"`, {
      known: [...Object.keys(SHORTHANDS), '@every <n><m|h|d>'],
    });
  }

  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    throw new HatsError(
      'CONFIG_INVALID',
      `"${input}": expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
      { example: '0 7 * * 1-5  — 07:00 on weekdays' },
    );
  }

  const [min, hr, dom, mon, dow] = parts as [string, string, string, string, string];
  const fields: CronFields = {
    minute: field(min, 0, 59, input),
    hour: field(hr, 0, 23, input),
    dayOfMonth: field(dom, 1, 31, input),
    month: field(mon, 1, 12, input, MONTH_NAMES, 1),
    dayOfWeek: field(dow, 0, 6, input, DAY_NAMES, 0),
    // Cron's oldest wart: when both day fields are restricted they OR rather than AND, so
    // `0 0 1 * 1` is the 1st *or* any Monday. Preserved because expressions are copied in
    // from crontabs and a subtly different meaning is worse than a strange one.
    bothDayFields: dom.trim() !== '*' && dow.trim() !== '*',
  };

  // Sunday is both 0 and 7 in every cron that matters.
  if (fields.dayOfWeek.has(7)) {
    fields.dayOfWeek.delete(7);
    fields.dayOfWeek.add(0);
  }

  return { kind: 'cron', expression: expanded, fields };
}

function field(
  spec: string,
  min: number,
  max: number,
  original: string,
  names?: string[],
  nameOffset = 0,
): Set<number> {
  const out = new Set<number>();

  for (const piece of spec.split(',')) {
    const [range, stepRaw] = piece.split('/') as [string, string | undefined];
    let step = 1;
    if (stepRaw !== undefined) {
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) {
        throw new HatsError('CONFIG_INVALID', `"${original}": bad step "/${stepRaw}"`, {});
      }
    }

    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-') as [string, string];
      lo = value(a, min, max, original, names, nameOffset);
      hi = value(b, min, max, original, names, nameOffset);
      if (lo > hi) {
        throw new HatsError('CONFIG_INVALID', `"${original}": range "${range}" runs backwards`, {});
      }
    } else {
      lo = value(range, min, max, original, names, nameOffset);
      // `5/15` means "from 5, every 15", but a bare `5` is just 5.
      hi = stepRaw === undefined ? lo : max;
    }

    for (let v = lo; v <= hi; v += step) out.add(v);
  }

  if (out.size === 0) {
    throw new HatsError('CONFIG_INVALID', `"${original}": field "${spec}" matches nothing`, {});
  }
  return out;
}

function value(
  token: string,
  min: number,
  max: number,
  original: string,
  names: string[] | undefined,
  nameOffset: number,
): number {
  const t = token.trim();
  if (names) {
    const idx = names.indexOf(t.slice(0, 3));
    if (idx >= 0) return idx + nameOffset;
  }
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HatsError('CONFIG_INVALID', `"${original}": "${token}" is not in ${min}-${max}`, {
      ...(names ? { orNames: names } : {}),
    });
  }
  return n;
}

/**
 * The next firing strictly after `after`, or null if the expression can never match
 * (`0 0 31 2 *`). `last` is only consulted for `@every`, which spaces itself from the
 * previous fire rather than from the clock.
 */
export function nextFire(schedule: Schedule, after: Date, last?: Date): Date | null {
  if (schedule.kind === 'every') {
    const base = last ?? after;
    const next = new Date(base.getTime() + schedule.ms);
    // A machine that was asleep for a week should fire once now, not spin forward
    // through every interval it missed.
    return next <= after ? new Date(after.getTime() + 60_000) : next;
  }

  const f = schedule.fields;
  const t = new Date(after.getTime());
  // Start at the top of the next minute; seconds are not a cron field.
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);

  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++) {
    if (matches(f, t)) return t;

    // Skipping whole days when the date cannot match turns the worst case from
    // half a million iterations into a few hundred.
    if (!dayMatches(f, t)) {
      t.setHours(0, 0, 0, 0);
      t.setDate(t.getDate() + 1);
      continue;
    }
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}

function matches(f: CronFields, d: Date): boolean {
  return f.minute.has(d.getMinutes()) && f.hour.has(d.getHours()) && dayMatches(f, d);
}

function dayMatches(f: CronFields, d: Date): boolean {
  if (!f.month.has(d.getMonth() + 1)) return false;
  const dom = f.dayOfMonth.has(d.getDate());
  const dow = f.dayOfWeek.has(d.getDay());
  return f.bothDayFields ? dom || dow : dom && dow;
}

/** Human-readable, for `hats schedule list` and the panel. */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === 'every') {
    const m = Math.round(schedule.ms / 60_000);
    if (m % 1440 === 0) return `every ${m / 1440} day(s)`;
    if (m % 60 === 0) return `every ${m / 60} hour(s)`;
    return `every ${m} minute(s)`;
  }
  const shorthand = Object.entries(SHORTHANDS).find(([, v]) => v === schedule.expression);
  return shorthand ? `${shorthand[0]} (${schedule.expression})` : schedule.expression;
}
