/**
 * `hats schedule` — create, inspect and run schedules, and the daemon that fires them.
 */

import { toHatsError } from '../core/errors.js';
import type { Profile } from '../core/config.js';
import { out, paint } from './render.js';
import {
  createSchedule,
  deleteSchedule,
  describeRecord,
  getSchedule,
  listSchedules,
  nextFireFor,
  saveSchedule,
  type ScheduleRecord,
} from '../schedule/store.js';
import { Scheduler } from '../schedule/runner.js';
import { summariseDecisions } from '../schedule/unattended.js';

type Flags = Record<string, string | boolean>;

export async function scheduleCommand(positional: string[], flags: Flags): Promise<number> {
  const sub = positional[0] ?? 'list';

  switch (sub) {
    case 'add':
      return add(positional.slice(1), flags);
    case 'list':
    case 'ls':
      return list();
    case 'show':
      return show(positional[1]);
    case 'run':
      return runNow(positional[1]);
    case 'rm':
    case 'remove':
    case 'delete':
      return remove(positional[1]);
    case 'enable':
      return setEnabled(positional[1], true);
    case 'disable':
      return setEnabled(positional[1], false);
    case 'daemon':
      return daemon();
    default:
      out.fail(`unknown: hats schedule ${sub}`);
      usage();
      return 1;
  }
}

function usage(): void {
  out.line(`
  hats schedule add "<request>" --at "<cron|@daily|@every 30m>" [--profile assisted]
                               [--allow-tool a,b] [--workspace <dir>]
  hats schedule list
  hats schedule show <id>
  hats schedule run <id>          fire it now, ignoring the timetable
  hats schedule enable|disable <id>
  hats schedule rm <id>
  hats schedule daemon            fire schedules until interrupted

  ${paint('Unattended runs are read-only by default. --profile trusted is refused: it means', 'grey')}
  ${paint('"approval pre-granted for the session", and a schedule has no session (ADR-0007).', 'grey')}
  ${paint('Under --profile assisted, every mutation is denied unless you name the tool with', 'grey')}
  ${paint('--allow-tool, which is you granting it now, while you are here to decide.', 'grey')}
`);
}

async function add(rest: string[], flags: Flags): Promise<number> {
  const request = rest.join(' ').trim();
  const at = typeof flags['at'] === 'string' ? flags['at'] : undefined;
  if (!request || !at) {
    out.fail('usage: hats schedule add "<request>" --at "<cron expression>"');
    usage();
    return 1;
  }

  const allowTools = toList(flags['allow-tool']);
  const record = await createSchedule({
    request,
    expression: at,
    workspace: typeof flags['workspace'] === 'string' ? flags['workspace'] : process.cwd(),
    ...(typeof flags['profile'] === 'string' ? { profile: flags['profile'] as Profile } : {}),
    allowTools,
    ...(typeof flags['notify'] === 'string' && typeof flags['to'] === 'string'
      ? { notify: { channel: flags['notify'], to: flags['to'] } }
      : {}),
  });

  out.ok(`scheduled ${paint(record.id, 'bold')} — ${describeRecord(record)}`);
  out.keyValue('request', record.request);
  out.keyValue('workspace', record.workspace);
  out.keyValue('profile', record.profile);
  const next = nextFireFor(record);
  out.keyValue('first run', next ? next.toLocaleString() : 'never');
  if (record.profile === 'read-only') {
    out.dim('  read-only: it will report what it would have done, and change nothing.');
  } else if (allowTools.length === 0) {
    out.warn('assisted with no --allow-tool: every mutation will be denied, and reported.');
  } else {
    out.keyValue('may run unattended', allowTools.join(', '));
  }
  out.dim('  nothing fires unless a scheduler is running: hats schedule daemon, or the panel.');
  return 0;
}

async function list(): Promise<number> {
  const all = await listSchedules();
  if (all.length === 0) {
    out.dim('no schedules yet');
    out.dim('  hats schedule add "summarise what changed in this repo today" --at "0 18 * * *"');
    return 0;
  }
  out.table(
    all.map((s) => {
      const next = nextFireFor(s);
      return [
        paint(s.id, 'grey'),
        s.enabled ? describeRecord(s) : paint('disabled', 'yellow'),
        s.profile,
        next ? next.toLocaleString() : '—',
        statusCell(s),
        s.request.length > 44 ? s.request.slice(0, 43) + '…' : s.request,
      ];
    }),
    ['id', 'when', 'profile', 'next', 'last', 'request'],
  );
  return 0;
}

function statusCell(s: ScheduleRecord): string {
  if (!s.lastStatus) return paint('never run', 'grey');
  if (s.lastStatus === 'ok') return paint('ok', 'green');
  if (s.lastStatus === 'skipped') return paint('skipped', 'yellow');
  return paint('failed', 'red');
}

async function show(id: string | undefined): Promise<number> {
  if (!id) {
    out.fail('usage: hats schedule show <id>');
    return 1;
  }
  const s = await getSchedule(id);
  out.heading(s.request);
  out.keyValue('id', s.id);
  out.keyValue('when', describeRecord(s) + (s.enabled ? '' : paint('  (disabled)', 'yellow')));
  out.keyValue('next', nextFireFor(s)?.toLocaleString() ?? '—');
  out.keyValue('workspace', s.workspace);
  out.keyValue('profile', s.profile);
  out.keyValue('may run unattended', s.allowTools.length ? s.allowTools.join(', ') : 'nothing');
  out.keyValue('author', s.author);
  out.keyValue('created', new Date(s.createdAt).toLocaleString());
  if (s.lastRunAt) {
    out.keyValue('last run', `${new Date(s.lastRunAt).toLocaleString()} · ${s.lastStatus ?? '?'}`);
    if (s.lastRunId) out.keyValue('last run id', s.lastRunId);
    if (s.lastSummary) out.keyValue('result', s.lastSummary);
  }
  if (s.missedRuns) {
    out.warn(`${s.missedRuns} firing(s) were missed while nothing was running. They were not replayed.`);
  }
  return 0;
}

async function runNow(id: string | undefined): Promise<number> {
  if (!id) {
    out.fail('usage: hats schedule run <id>');
    return 1;
  }
  const record = await getSchedule(id);
  out.dim(`running ${record.id} now — ${record.request}`);
  // No lock: this is a one-off in the foreground, not a second scheduler.
  const outcome = await new Scheduler().runNow(record.id);

  if (outcome.error) {
    out.fail(outcome.error);
    return 1;
  }
  out.line();
  out.line(outcome.answer);
  const note = summariseDecisions(outcome.decisions);
  if (note) {
    out.line();
    out.warn(note);
  }
  return outcome.ok ? 0 : 1;
}

async function remove(id: string | undefined): Promise<number> {
  if (!id) {
    out.fail('usage: hats schedule rm <id>');
    return 1;
  }
  const s = await deleteSchedule(id);
  out.ok(`removed ${s.id} — ${s.request}`);
  return 0;
}

async function setEnabled(id: string | undefined, enabled: boolean): Promise<number> {
  if (!id) {
    out.fail(`usage: hats schedule ${enabled ? 'enable' : 'disable'} <id>`);
    return 1;
  }
  const s = await getSchedule(id);
  await saveSchedule({ ...s, enabled });
  out.ok(`${s.id} ${enabled ? 'enabled' : 'disabled'} — ${s.request}`);
  return 0;
}

async function daemon(): Promise<number> {
  const scheduler = new Scheduler(undefined, (outcome, record) => {
    const when = new Date().toLocaleTimeString();
    if (outcome.error) out.fail(`${when}  ${record.id}  ${outcome.error}`);
    else out.ok(`${when}  ${record.id}  ${outcome.answer.split('\n')[0]?.slice(0, 90) ?? ''}`);
    const note = summariseDecisions(outcome.decisions);
    if (note) out.dim(`        ${note}`);
  });

  try {
    await scheduler.start();
  } catch (e) {
    out.fail(toHatsError(e).message);
    return 1;
  }

  const all = await listSchedules();
  const active = all.filter((s) => s.enabled);
  out.ok(`scheduler running · ${active.length} active schedule(s) · ctrl-c to stop`);
  for (const s of active) {
    out.keyValue(s.id, `${describeRecord(s)} → ${nextFireFor(s)?.toLocaleString() ?? '—'}`);
  }
  if (active.length === 0) out.dim('  nothing to fire yet: hats schedule add ...');

  await new Promise<void>((resolve) => {
    const stop = () => {
      out.line();
      out.dim('stopping');
      void scheduler.stop().then(resolve);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
  return 0;
}

function toList(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
