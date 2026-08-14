/**
 * The interactive session.
 *
 * Each turn is its own run — its own run record, its own audit trail, its own gates —
 * carrying the prior messages as history. That keeps "which run produced this claim"
 * answerable, which is the property the whole architecture is built around.
 */

import { describePromotion, runAutoPromotion } from '../engine/autonomy.js';
import { mineProposals } from '../engine/mine.js';
import { knownEnforcementPoints } from '../engine/gates.js';
import { runAgent, type RunEvent, type RunResult } from '../engine/run.js';
import { Registry } from '../registry/loader.js';
import type { Message } from '../providers/types.js';
import type { Session } from './session.js';
import { createPrompter, eventPrefix, out, paint, type Prompter } from './render.js';
import { showLessons, showProposals, showRuns, showMemory } from './inspect.js';

const HISTORY_MESSAGES = 40;

export async function runRepl(session: Session, prompter: Prompter = createPrompter()): Promise<void> {
  printHeader(session);

  let history: Message[] = [];
  let lastRun: RunResult | undefined;
  let verbose = true;

  for (;;) {
    const input = await prompter.question(paint('\n› ', 'bold'));
    if (!input) continue;

    if (input.startsWith('/')) {
      const [command = '', ...rest] = input.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      if (command === 'exit' || command === 'quit') break;
      if (command === 'help') {
        printHelp();
        continue;
      }
      if (command === 'new') {
        history = [];
        out.dim('history cleared — the next turn starts fresh (memory is unaffected)');
        continue;
      }
      if (command === 'quiet') {
        verbose = !verbose;
        out.dim(verbose ? 'showing steps' : 'hiding steps');
        continue;
      }
      if (command === 'profile') {
        if (arg === 'read-only' || arg === 'assisted' || arg === 'trusted') {
          session.config.profile = arg;
          session.profile = arg;
          out.dim(`profile is now ${arg} for this session`);
        } else {
          out.dim(`profile: ${session.profile}  (use /profile read-only|assisted|trusted)`);
        }
        continue;
      }
      if (command === 'feedback') {
        await handleFeedback(session, lastRun, arg);
        continue;
      }
      if (command === 'lessons') {
        await showLessons(session);
        continue;
      }
      if (command === 'proposals') {
        await showProposals();
        continue;
      }
      if (command === 'runs') {
        await showRuns(session);
        continue;
      }
      if (command === 'memory') {
        await showMemory(session);
        continue;
      }
      out.warn(`unknown command /${command} — try /help`);
      continue;
    }

    try {
      lastRun = await execute(session, input, history, prompter, verbose);
      history = lastRun.messages.slice(-HISTORY_MESSAGES);
    } catch (e) {
      out.fail((e as Error).message);
    }
  }

  prompter.close();
}

export async function execute(
  session: Session,
  request: string,
  history: Message[],
  prompter: Prompter,
  verbose: boolean,
  skillOverride?: string,
): Promise<RunResult> {
  const onEvent = (e: RunEvent) => {
    if (e.type === 'answer') return;
    if (!verbose && e.type !== 'gate' && e.type !== 'note' && e.type !== 'review') return;
    out.line(`${eventPrefix(e.type)} ${paint(e.message, 'grey')}`);
  };

  const result = await runAgent({
    request,
    workspaceRoot: session.workspaceRoot,
    config: session.config,
    registry: session.registry,
    pool: session.pool,
    memory: session.memory,
    documents: session.documents,
    profile: session.profile,
    handlers: session.handlers,
    history,
    ...(skillOverride ? { skillOverride } : {}),
    onEvent,
    ask: async ({ question, options }) => {
      out.line('');
      out.line(paint('? ', 'yellow') + question);
      (options ?? []).forEach((o, i) => out.line(`    ${i + 1}. ${o}`));
      const answer = await prompter.question('  > ');
      const index = Number(answer);
      if (options && Number.isInteger(index) && options[index - 1]) return options[index - 1] as string;
      return answer;
    },
    approve: async ({ tool, headline, detail }) => {
      out.line('');
      out.line(paint(`  approval needed: ${tool}`, 'yellow'));
      out.dim(`  ${headline}`);
      out.line(detail.split('\n').map((l) => `    ${l}`).join('\n'));
      return prompter.confirm('  run it?', false);
    },
  });

  out.line('');
  out.line(result.answer);

  if (result.pendingQuestion) {
    out.dim('\n(the run paused for clarification — answer above and ask again)');
  }
  out.dim(
    `\n${result.runId} · ${result.steps}/${result.stepBudget} steps · ${result.outcomeId} · ${result.profile}` +
      ` · ${result.artifactCount} artifacts · ${result.modelsUsed.join(', ')}`,
  );
  out.dim('/feedback good | bad | correct <what it should have said>');

  await distil(session, result, request);
  return result;
}

async function distil(session: Session, result: RunResult, request: string): Promise<void> {
  try {
    const distilled = await session.memory.distill({
      runId: result.runId,
      question: request,
      answer: result.answer,
      signals: {
        ok: result.ok,
        deniedTools: result.observations.filter((o) => o.ruleId).map((o) => o.tool),
        failedTools: result.observations.filter((o) => !o.ok && !o.ruleId).map((o) => o.tool),
        gateFailures: result.gateFindings.filter((g) => !g.passed).map((g) => g.ruleId),
        steps: result.steps,
        stepBudget: result.stepBudget,
        sandboxDescriptors: result.sandboxDescriptors,
      },
    });
    if (distilled.lessons.length > 0) {
      out.dim(`learned: ${distilled.lessons.map((l) => `“${l.text}” [${l.status}]`).join('; ')}`);
    }
    if (distilled.refused.length > 0) {
      out.warn(`refused ${distilled.refused.length} lesson(s) that tried to widen access`);
    }

    // ADR-0006. Silent on `supervised`, which is the default.
    // Recurrence is only visible across runs, so it is checked here rather than inside one.
    // Never allowed to fail a run that already succeeded.
    const mined = await mineProposals(session.slug, session.config, session.logger).catch(() => []);
    for (const m of mined) {
      out.dim(`noticed: this is the ${m.occurrences}${nth(m.occurrences)} time — staged a ${m.kind} proposal "${m.title}" (hats proposals)`);
    }
    const promotion = await runAutoPromotion(session.config, session.logger);
    const announcement = describePromotion(promotion);
    if (announcement) {
      out.warn(announcement);
      session.registry = await Registry.load({ knownGates: knownEnforcementPoints() });
    }
  } catch (e) {
    out.dim(`(distillation skipped: ${(e as Error).message})`);
  }
}

async function handleFeedback(
  session: Session,
  lastRun: RunResult | undefined,
  arg: string,
): Promise<void> {
  if (!lastRun) {
    out.warn('no run in this session yet');
    return;
  }
  const [word = '', ...rest] = arg.split(/\s+/);
  const note = rest.join(' ');
  const verdict =
    word === 'good' || word === 'accepted'
      ? 'accepted'
      : word === 'bad' || word === 'rejected'
        ? 'rejected'
        : word === 'correct' || word === 'corrected'
          ? 'corrected'
          : null;
  if (!verdict) {
    out.dim('/feedback good | bad | correct <what it should have said>');
    return;
  }
  if (verdict === 'corrected' && !note) {
    out.warn('a correction needs the correct answer after it');
    return;
  }
  const applied = await session.memory.feedback(lastRun.runId, verdict, note || undefined);
  out.ok(
    `recorded: ${verdict} · ${applied.takeawaysTouched} takeaway(s), ${applied.lessonsTouched} lesson(s) reweighted` +
      (applied.lessonAdded ? ` · new lesson “${applied.lessonAdded.text}”` : ''),
  );
}

function printHeader(session: Session): void {
  const tiers = Object.entries(session.config.tiers)
    .map(([t, m]) => `${t}=${m}`)
    .join(' ');
  out.line('');
  out.line(paint('  hats', 'bold') + paint('  one agent, many hats', 'grey'));
  out.keyValue('workspace', session.workspaceRoot);
  out.keyValue('profile', profileLabel(session.profile));
  out.keyValue('models', tiers || `${session.config.defaultProvider} (no tiers bound — run hats init)`);
  out.keyValue(
    'network',
    session.config.network.enabled ? paint('enabled', 'yellow') : 'off (tool egress denied)',
  );
  out.dim('\n  /help for commands, /exit to leave');
}

function profileLabel(profile: string): string {
  switch (profile) {
    case 'read-only':
      return `${profile} ${paint('· worst case is a wrong answer', 'grey')}`;
    case 'assisted':
      return `${paint(profile, 'yellow')} ${paint('· writes and commands, each approved', 'grey')}`;
    default:
      return `${paint(profile, 'red')} ${paint('· writes and commands, approval pre-granted', 'grey')}`;
  }
}

function printHelp(): void {
  out.heading('commands');
  out.table([
    ['/feedback good|bad|correct <note>', 'rate the last answer — this is how it learns'],
    ['/lessons', 'what it has learned here, and each lesson’s status'],
    ['/proposals', 'skills, rules and tools it has proposed for your review'],
    ['/runs', 'recent runs in this workspace'],
    ['/memory', 'what it remembers about this workspace'],
    ['/profile <p>', 'read-only | assisted | trusted, for this session'],
    ['/new', 'clear conversation history (memory is untouched)'],
    ['/quiet', 'toggle step-by-step output'],
    ['/exit', 'leave'],
  ]);
}

/** 1st, 2nd, 3rd, 4th. */
function nth(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
