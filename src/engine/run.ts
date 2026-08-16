/**
 * The run: composition at start, then one bounded reason-act loop wearing many hats.
 *
 * Paper §2.1/§2.2. One agent, one transcript, one audit trail. Roles are stances adopted
 * for a step and discarded. Stages are gate and telemetry boundaries on that single
 * timeline, not separate agents and not separate transcripts.
 */

import path from 'node:path';

import type { HatsConfig, Profile, Tier } from '../core/config.js';
import { HatsError, isHatsError, toHatsError } from '../core/errors.js';
import { Logger, droppedRecords } from '../core/logger.js';
import { setContext, withContext } from '../core/context.js';
import { redactSecrets } from '../core/redact.js';
import { auditQuietly } from '../core/audit.js';
import { PathGuard, controlPlane, hatsHome, runDir, workspaceSlug } from '../core/paths.js';
import { appendJsonl, ensureDir, newRunId, utcStamp, writeJsonAtomic } from '../core/store.js';
import type { MemoryLayers } from '../memory/index.js';
import type { ProviderPool } from '../providers/index.js';
import type { ChatResponse, Message, ToolCall } from '../providers/types.js';
import type { Registry } from '../registry/loader.js';
import type { Skill } from '../registry/types.js';
import { ArtifactStore } from '../tools/artifacts.js';
import { Executor } from '../tools/executor.js';
import { ALL_TOOLS, toSchemas, toolRegistry } from '../tools/index.js';
import type {
  ApprovalRequest,
  ClarificationRequest,
  DocumentAccess,
  ToolContext,
  ToolHandler,
  ToolObservation,
} from '../tools/types.js';
import {
  buildAllowlist,
  buildSystemParts,
  buildSystemPrompt,
  loadSkills,
  route,
  routeTier,
  selectHat,
  type Stage,
} from './compose.js';
import { renderGateDisclosure, renderGateFeedback, runVerificationGates, type GateFinding } from './gates.js';
import { stalled } from './vigilance.js';

const DISCOVERY_TOOLS = new Set(['list_dir', 'read_file', 'search_files', 'recall_memory']);
const MAX_GATE_RECOVERIES = 1;

export interface RunEvent {
  type:
    | 'route'
    | 'compose'
    | 'step'
    | 'hat'
    | 'tool'
    | 'stage'
    | 'gate'
    | 'review'
    | 'answer'
    | 'note';
  message: string;
  data?: Record<string, unknown>;
}

export interface RunOptions {
  request: string;
  workspaceRoot: string;
  config: HatsConfig;
  registry: Registry;
  pool: ProviderPool;
  memory: MemoryLayers;
  documents?: DocumentAccess;
  profile?: Profile;
  skillOverride?: string;
  /** Prior turns, for a REPL session. Each turn is still its own run record. */
  history?: Message[];
  ask?: (r: ClarificationRequest) => Promise<string>;
  approve?: (r: ApprovalRequest) => Promise<boolean>;
  /**
   * Set when nobody is at the keyboard (ADR-0007). Recorded on the run so the audit trail
   * keeps a person behind every entry, and it changes what a denied tool is told: advice
   * to "ask what they want instead" is a dead end when there is no one to ask.
   */
  trigger?: { kind: 'schedule' | 'message'; id: string; actor: string };
  onEvent?: (e: RunEvent) => void;
  handlers?: ToolHandler[];
  signal?: AbortSignal;
}

export interface RunResult {
  runId: string;
  ok: boolean;
  answer: string;
  stage: Stage;
  steps: number;
  stepBudget: number;
  outcomeId: string;
  profile: Profile;
  gateFindings: GateFinding[];
  observations: ToolObservation[];
  messages: Message[];
  artifactCount: number;
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };
  modelsUsed: string[];
  protocolDowngraded: boolean;
  /** Paper §4: repeated descriptors are the evidence that a named tool should exist. */
  sandboxDescriptors: string[];
  /** Set when the run paused for the human instead of finishing. */
  pendingQuestion?: { question: string; options?: string[] };
  runDir: string;
}

/**
 * Establishes the correlation context, then runs.
 *
 * The identifiers are set before any work happens so that everything below — including the
 * HTTP layer three modules down, which has no route to this logger — emits records naming
 * the run, the workspace and who caused it. Without this the trail broke at the first
 * async boundary that did not take a logger as an argument, which is exactly where the
 * interesting failures live.
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const runId = newRunId();
  const slug = workspaceSlug(opts.workspaceRoot);
  return withContext(
    {
      runId,
      workspace: slug,
      // ADR-0007 §6: absent trigger means a person ran it from the keyboard.
      actor: opts.trigger?.actor ?? 'local',
      source: opts.trigger?.kind ?? 'cli',
    },
    () => runAgentInner(opts, runId, slug),
  );
}

async function runAgentInner(opts: RunOptions, runId: string, slug: string): Promise<RunResult> {
  const started = Date.now();
  const dir = runDir(slug, runId);
  await ensureDir(dir);

  const profile = opts.profile ?? opts.config.profile;
  const logger = new Logger({ file: path.join(dir, 'audit.jsonl'), base: { runId }, minLevel: 'info' });
  // Records emitted below the layers that hold a logger land here, beside the step that
  // provoked them, rather than in a separate file a reader would have to join.
  setContext({ sink: logger });
  const emit = (e: RunEvent) => opts.onEvent?.(e);

  // A run that starts and never says so cannot be told apart from one that never started.
  logger.info('run.started', {
    profile,
    request: opts.request,
    workspaceRoot: opts.workspaceRoot,
    ...(opts.trigger ? { trigger: opts.trigger.kind, triggerId: opts.trigger.id } : {}),
  });
  await auditQuietly({
    action: 'run.started',
    actor: opts.trigger?.actor ?? 'local',
    source: opts.trigger?.kind ?? 'cli',
    subject: slug,
    outcome: 'allowed',
    runId,
    detail: { profile, workspaceRoot: opts.workspaceRoot },
  });

  const handlers = opts.handlers ?? ALL_TOOLS;
  const artifacts = new ArtifactStore(path.join(dir, 'artifacts'), runId);
  const transcriptFile = path.join(dir, 'transcript.jsonl');

  // --- run start: five decisions, in order, none requiring model judgement ---

  // 1. Route.
  const decision = route(
    opts.request,
    opts.registry,
    profile,
    opts.skillOverride,
    opts.config.network.enabled,
  );
  const outcome = opts.registry.skill(decision.outcomeId);
  logger.info('run.route', { outcome: outcome.id, version: outcome.version, reason: decision.reason });
  emit({ type: 'route', message: `${outcome.id} v${outcome.version} (${decision.reason})` });

  // 2 + 3. Registry is already bootstrapped; load the essential skills for this stage.
  let stage: Stage = 'intake';
  let skills = loadSkills(opts.registry, outcome, stage, opts.request);

  // Memory composition (paper §5) happens before the first prompt, not lazily.
  const composed = await opts.memory.compose(opts.request, runId);
  const persona = await opts.memory.persona.get();
  const conservative = persona.runCount < opts.config.coldStart.conservativeRuns;
  emit({
    type: 'compose',
    message: `${skills.length} skills, memory layers: ${
      ['org-context', 'persona', 'takeaways', 'lessons']
        .filter((l) => !composed.emptyLayers.includes(l))
        .join(', ') || 'none yet'
    }${conservative ? ' · conservative profile' : ''}`,
  });

  // 5. Allowlist: intersection, never union.
  const { allowlist, dropped } = buildAllowlist(outcome, handlers, opts.config, profile);
  if (dropped.length > 0) {
    logger.info('run.allowlist.dropped', { dropped });
    emit({
      type: 'note',
      message: `not available: ${dropped.map((d) => `${d.tool} (${d.why})`).join(', ')}`,
    });
  }

  // A step counter cannot tell whether step 19 was progress or thrashing, so it stops good
  // runs and lets bad ones burn to the ceiling either way. `limits.stepBudget: 0` means no
  // counter at all: the run ends when it delivers, or when it stops making progress — which
  // is the condition anyone actually cares about. A ceiling is still available for people
  // who want a hard cost cap.
  const unlimited = opts.config.limits.stepBudget === 0;
  const stepBudget = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.min(
        outcome.stepBudget ?? opts.config.limits.stepBudget,
        opts.config.limits.stepBudget * 2,
      );

  const sandboxDescriptors: string[] = [];
  const ctx: ToolContext = {
    runId,
    workspaceSlug: slug,
    workspaceRoot: opts.workspaceRoot,
    profile,
    stage,
    config: opts.config,
    // $HATS_HOME is in scope for run artifacts and the workspace store, so the control
    // plane inside it is fenced off explicitly — otherwise a write_file into grants/ is a
    // standing permission the agent issued to itself.
    guard: new PathGuard([opts.workspaceRoot, hatsHome()], controlPlane()),
    artifacts,
    logger,
    memory: opts.memory,
    ...(opts.documents ? { documents: opts.documents } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ask:
      opts.ask ??
      (async (r) => {
        throw new HatsError('CLARIFICATION_REQUIRED', r.question, { options: r.options ?? [] });
      }),
    approve: opts.approve ?? (async () => false),
    ...(opts.trigger ? { unattended: true } : {}),
    recordTaskDescriptor: (d) => sandboxDescriptors.push(d),
  };

  // Held so a tool the agent writes mid-run can join both, which is the only way
  // build_tool is useful in the run that discovered the gap (ADR-0011).
  const liveRegistry = toolRegistry(handlers);
  /**
   * Tools written during this run. Kept separately because the per-step allowlist is
   * recomputed from the *skill's* declared list, and a tool that did not exist when the
   * skill was written can never appear in it — so adding it to the run-level set was
   * silently discarded on the very next step, and the agent watched its own new tool come
   * back as "not permitted by the active skill".
   *
   * Unioned in rather than intersected: this is a real widening of the skill's surface, and
   * it is the one the skill asked for when it listed `build_tool`.
   */
  const selfBuilt = new Set<string>();
  ctx.installTool = (handler) => {
    liveRegistry.set(handler.spec.name, handler);
    selfBuilt.add(handler.spec.name);
    allowlist.add(handler.spec.name);
    logger.warn('run.tool.installed', { tool: handler.spec.name });
    emit({ type: 'note', message: `${handler.spec.name} is now callable in this run` });
  };
  const executor = new Executor(liveRegistry, ctx);
  // Seeded without the opening request, which is appended through `record` below so it
  // reaches the transcript. It used to be pushed straight in here and therefore never
  // written: every transcript on disk began with the agent's reply to a question the file
  // did not contain, which is a hole in the audit trail as much as in the UI.
  const messages: Message[] = [...(opts.history ?? [])];
  const observations: ToolObservation[] = [];
  const modelsUsed = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

  let step = 0;
  let discoveryCount = 0;
  let planned = false;
  let recoveries = 0;
  let emptyTurns = 0;
  /** Said once. A nudge repeated every step is noise the model learns to skip. */
  let stallWarned = false;
  /** Set when a run that is going nowhere has been told to deliver. Ends the loop. */
  let stalledOut = false;
  let protocolDowngraded = false;
  let reviewVerdict: { role: string; verdict: string; detail: string } | undefined;
  /** The exact text handed to the reviewer, so a PASS delivers it verbatim. */
  let draftUnderReview = '';
  /**
   * A review has been asked for and not yet answered. Tracked rather than inferred from
   * the stage, because a reviewer that calls a tool (check_consistency, say) advances the
   * stage back to `act`, and the verdict then arrives in a step that no longer looks like
   * a review — so it gets read as a fresh draft and reviewed again, forever.
   * [Seen in a live scheduled run, 2026-08-14.]
   */
  let awaitingReview = false;
  let gateFindings: GateFinding[] = [];
  let answer = '';
  let ok = false;
  let pendingQuestion: { question: string; options?: string[] } | undefined;

  /**
   * @param internal  True for a turn this loop wrote to steer itself — a review handshake,
   *   gate feedback, a stall warning. They are genuinely part of the conversation the model
   *   had, so the transcript keeps them for the audit trail, and they are not part of the
   *   conversation the *person* had. Marking them here rather than pattern-matching their
   *   wording later means rephrasing a prompt cannot silently start leaking scaffolding
   *   into the chat someone reopens.
   */
  const record = async (m: Message, internal = false) => {
    messages.push(m);
    // The transcript is the one store that holds raw model input and output, so it is
    // governed differently from the operational log next to it: 0600 rather than 0644,
    // credential shapes stripped on the way in, and its own retention clock (see
    // `src/core/retention.ts`). It is kept because reopening a conversation needs it, not
    // because operations needs it — nothing here should be read to debug a slow run.
    await appendJsonl(
      transcriptFile,
      {
        ts: utcStamp(),
        ...m,
        content: redactSecrets(m.content),
        // Tool arguments travel on the assistant turn, and a credential handed to a tool
        // lands here just as readily as one typed into the message. Redacting `content`
        // alone left it on disk — found by planting a key and grepping the file rather
        // than by reading this function.
        ...(m.toolCalls
          ? { toolCalls: JSON.parse(redactSecrets(JSON.stringify(m.toolCalls))) as typeof m.toolCalls }
          : {}),
        ...(internal ? { internal: true } : {}),
      },
      { mode: 0o600 },
    );
  };

  await record({ role: 'user', content: opts.request });

  try {
    // `stalledOut` is what ends an unlimited run: the counter is gone, so "it has stopped
    // getting anywhere" is the terminating condition.
    while (step < stepBudget && !stalledOut) {
      step++;
      const stepStarted = Date.now();
      // try/finally, not a line at each exit: this loop leaves by eight different paths
      // (continue, break, an answer, a gate recovery, a thrown error) and a duration that
      // is only recorded on the tidy paths would systematically under-report exactly the
      // steps worth looking at.
      try {
        const exhausted = step >= stepBudget || stalledOut;
        // So a tool denial on the final step explains itself rather than blaming the allowlist.
        ctx.budgetExhausted = exhausted;
        const lastText = lastAssistantText(messages);
        const lastToolNames = observations.slice(-3).map((o) => o.tool);

        const reviewPass: 'guardian' | 'critic' | undefined =
          (stage === 'verify' || awaitingReview) && outcome.review !== 'none' && !reviewVerdict
            ? outcome.review
            : undefined;

        const hat = selectHat(opts.registry, {
          stage,
          step,
          request: opts.request,
          lastText,
          lastToolNames,
          exhausted,
          ...(reviewPass ? { reviewPass } : {}),
          multiStep: outcome.stages.includes('plan'),
        });
        if (hat.skill) {
          logger.info('run.hat', { role: hat.skill.role, reason: hat.reason, step, stage });
          emit({ type: 'hat', message: `${hat.skill.role} — ${hat.reason}` });
        }

        // Per-step composition in miniature (paper §2.6.4).
        skills = loadSkills(opts.registry, outcome, stage, opts.request);
        const stepAllowlist = buildAllowlist(
          outcome,
          handlers,
          opts.config,
          profile,
          hat.skill,
          hat.deterministic,
        ).allowlist;
        for (const name of selfBuilt) stepAllowlist.add(name);
        const rules = opts.registry.rulesInScope({
          stage,
          tools: [...stepAllowlist],
          profile,
          outcome: outcome.id,
        });

        const systemParts = buildSystemParts({
          skills,
          ...(hat.skill ? { hat: hat.skill } : {}),
          rules,
          memoryBlock: composed.block,
          workspaceRoot: opts.workspaceRoot,
          profile,
          networkEnabled: opts.config.network.enabled,
          stage,
          stepsLeft: stepBudget - step,
          conservative,
        });

        const system = systemParts.full;
        const contextChars = system.length + messages.reduce((a, m) => a + m.content.length, 0);
        const tier = routeTier({
          stage,
          ...(hat.skill ? { hat: hat.skill } : {}),
          outcome,
          contextChars,
          budgetChars: opts.config.limits.contextCharBudget,
        });
        const bound = opts.pool.resolve(tier.tier);
        modelsUsed.add(`${bound.providerId}/${bound.model}`);

        const visible = executor.visibleTools(stepAllowlist);
        // Narrow the ambient context so every record from here down — tool calls, provider
        // retries — says which step and stage it belongs to.
        setContext({ step, stage });
        logger.info('run.step', {
          step,
          stage,
          tier: tier.tier,
          tierReason: tier.reason,
          model: `${bound.providerId}/${bound.model}`,
          contextChars,
          tools: visible.length,
        });
        emit({
          type: 'step',
          message: `step ${step}${unlimited ? '' : `/${stepBudget}`} · ${stage} · ${tier.tier} (${bound.providerId}/${bound.model})`,
          data: { step, stage, tier: tier.tier },
        });

        const response = await callModel(
          logger,
          () =>
            bound.provider.chat({
              model: bound.model,
              system,
              systemParts: { stable: systemParts.stable, volatile: systemParts.volatile },
              messages,
              tools: toSchemas(visible),
              temperature: stage === 'deliver' || stage === 'verify' ? 0.2 : 0.3,
              ...(opts.signal ? { signal: opts.signal } : {}),
            }),
          {
            purpose: 'step',
            providerId: bound.providerId,
            model: bound.model,
            tier: tier.tier,
            step,
            stage,
            contextChars,
            toolsOffered: visible.length,
          },
        );

        usage.inputTokens += response.usage.inputTokens ?? 0;
        usage.outputTokens += response.usage.outputTokens ?? 0;
        usage.cacheWriteTokens += response.usage.cacheWriteTokens ?? 0;
        usage.cacheReadTokens += response.usage.cacheReadTokens ?? 0;
        if (response.protocolUsed === 'text') {
          if (!protocolDowngraded) {
            emit({
              type: 'note',
              message: `${bound.model} has no native tool calling — using the text protocol (less reliable)`,
            });
          }
          protocolDowngraded = true;
        }

        // A review pass is the agent grading its own draft, not answering the person. It is
        // kept in the transcript and in the trace, and it is not part of the conversation
        // someone reopens — "I need to review the draft I just delivered against the guardian
        // checklist" reads as the agent talking to itself, which is exactly what it is.
        await record(
          {
            role: 'assistant',
            content: response.text,
            ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
          },
          reviewPass !== undefined,
        );

        // A run that is going in circles cannot tell. One run revised its approach at step
        // 140 of 151; the signs were there from about step 20. The loop notices on the
        // model's behalf and says so once, rather than letting it grind to the budget.
        const circling = stalled(observations);
        if (circling.stalled && !stallWarned) {
          stallWarned = true;
          emit({ type: 'note', message: `not making progress — ${circling.reason.split('.')[0]}` });
          await record({ role: 'user', content: `Stop and reconsider: ${circling.reason}` }, true);
        } else if (circling.stalled && stallWarned) {
          // Warned once and still going in circles. With no step counter this is the
          // terminating condition: something has to end an unbounded loop, and "it is no
          // longer getting anywhere" is a better reason than "it reached nineteen".
          stalledOut = true;
          emit({ type: 'note', message: 'still not making progress — delivering what it has' });
          await record({
            role: 'user',
            content:
              'You are repeating yourself and it is not working. Deliver the best answer the ' +
              'evidence above supports, state plainly what you could not establish and why, ' +
              'and do not call another tool.',
          }, true);
        }

        // --- acting ---
        if (response.toolCalls.length > 0) {
          const limit = opts.config.limits.maxToolCallsPerStep;
          const calls = response.toolCalls.slice(0, limit);
          for (const call of calls) {
            ctx.stage = stage;
            const observation = await executeCall(executor, call, stepAllowlist, emit);
            observations.push(observation);
            if (DISCOVERY_TOOLS.has(call.name) && observation.ok) discoveryCount++;
            await record({
              role: 'tool',
              content: observation.summary,
              toolCallId: call.id,
              name: call.name,
              ...(observation.images?.length ? { images: observation.images } : {}),
            });
          }

          // Every tool call the model made needs an answer, including the ones over the
          // per-step limit. Recording the assistant turn with eight tool_use blocks and
          // replying with four tool_results makes Anthropic reject the *next* request
          // outright — "tool_use ids were found without tool_result blocks" — and the run
          // dies mid-way with nothing delivered. Declining a call is a legitimate answer to
          // it; silence is not. [Seen in a live panel run, 2026-08-14.]
          for (const skipped of response.toolCalls.slice(limit)) {
            emit({
              type: 'note',
              message: `${skipped.name} was not run — ${limit} tool calls per step is the limit`,
            });
            await record({
              role: 'tool',
              content:
                `Not run: you requested ${response.toolCalls.length} tool calls in one step and the ` +
                `limit is ${limit}. Nothing failed — ask for this one again in the next step if you ` +
                `still need it.`,
              toolCallId: skipped.id,
              name: skipped.name,
            });
          }
          const next = advanceStage(stage, {
            usedTools: true,
            discoveryCount,
            hasPlanStage: outcome.stages.includes('plan'),
            planned,
          });
          if (next === 'plan') planned = true;
          if (next !== stage) {
            logger.info('run.stage', { from: stage, to: next });
            emit({ type: 'stage', message: `${stage} -> ${next}` });
            stage = next;
          }
          continue;
        }

        // --- no tool calls: the model believes it is done ---
        const draft = response.text.trim();

        // An empty turn is not an answer. Small local models produce these; delivering one
        // would ship a disclosure block attached to nothing.
        if (!draft) {
          emptyTurns++;
          logger.warn('run.empty_turn', { step, emptyTurns });
          if (emptyTurns > 2) {
            emit({ type: 'note', message: 'the model returned nothing three times — stopping' });
            break;
          }
          await record({
            role: 'user',
            content:
              'You replied with nothing. Either call one of the tools you were given, or write the answer in plain text.',
          }, true);
          continue;
        }

        if (reviewPass) {
          awaitingReview = false;
          reviewVerdict = parseVerdict(reviewPass, draft);
          logger.info('run.review', { role: reviewPass, verdict: reviewVerdict.verdict });
          emit({ type: 'review', message: `${reviewPass}: ${reviewVerdict.verdict}` });
          if (reviewVerdict.verdict !== 'PASS') {
            await record({
              role: 'user',
              content: `The ${reviewPass} found problems:\n${reviewVerdict.detail}\n\nAddress them and produce the final answer.`,
            }, true);
            stage = 'act';
            // The corrected draft is a different draft: it has to be reviewed again.
            // Keeping the stale FAIL would block delivery for the rest of the run no
            // matter what the model produced. [Found by a real run, 2026-08-14.]
            reviewVerdict = undefined;
            continue;
          }
          // Review passed; deliver the draft the review was actually about.
          const prior = draftUnderReview || lastAssistantTextBefore(messages, draft);
          gateFindings = runVerificationGates({
            draft: prior,
            artifacts: artifacts.all(),
            reviewRequired: outcome.review,
            runId: ctx.runId,
            reviewVerdict,
            usedTools: observations.length > 0,
            observations,
            allowlist: [...allowlist],
          });
          const outcomeOfGates = await settle(prior, gateFindings, recoveries, record, emit, logger);
          if (outcomeOfGates.retry) {
            recoveries++;
            stage = 'act';
            continue;
          }
          answer = outcomeOfGates.answer;
          ok = true;
          stage = 'deliver';
          break;
        }

        if (stage !== 'verify') {
          stage = 'verify';
          logger.info('run.stage', { from: 'act', to: 'verify' });
          emit({ type: 'stage', message: `act -> verify` });
        }

        gateFindings = runVerificationGates({
          draft,
          artifacts: artifacts.all(),
          reviewRequired: outcome.review,
          runId: ctx.runId,
          ...(reviewVerdict ? { reviewVerdict } : {}),
          usedTools: observations.length > 0,
          observations,
          allowlist: [...allowlist],
        });

        const needsReview = outcome.review !== 'none' && !reviewVerdict && !awaitingReview;
        if (needsReview) {
          awaitingReview = true;
          // Remember exactly what is being reviewed. Recovering it afterwards by scanning
          // backwards for "the last assistant text that is not the verdict" guesses wrong as
          // soon as the model emits two verdicts, or a line of filler, between draft and
          // verdict — and then ships that instead of the answer.
          // [Seen in a live scheduled run, 2026-08-14.]
          draftUnderReview = draft;
          await record({
            role: 'user',
            content: `Before this is delivered it must pass the ${outcome.review} check. Review the draft above against your ${outcome.review} playbook and reply with the verdict.`,
          }, true);
          continue;
        }

        const settled = await settle(draft, gateFindings, recoveries, record, emit, logger);
        if (settled.retry) {
          recoveries++;
          stage = 'act';
          continue;
        }
        answer = settled.answer;
        ok = true;
        stage = 'deliver';
        break;
      } finally {
        logger.info('run.step.finished', { step, stage, durationMs: Date.now() - stepStarted });
      }
    }

    // Budget exhausted without an answer: the reflector is terminal authority (paper §2.2).
    if (!answer) {
      emit({ type: 'note', message: 'step budget exhausted — reflector pass' });
      answer = await reflectorPass({
        registry: opts.registry,
        pool: opts.pool,
        config: opts.config,
        outcome,
        messages,
        record,
        logger,
        workspaceRoot: opts.workspaceRoot,
        profile,
        memoryBlock: composed.block,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      ok = false;
    }
  } catch (e) {
    const err = toHatsError(e);
    if (err.code === 'CLARIFICATION_REQUIRED') {
      pendingQuestion = {
        question: err.message,
        options: (err.context['options'] as string[]) ?? [],
      };
      answer = err.message;
      logger.info('run.paused', { question: err.message });
      emit({ type: 'note', message: 'paused for clarification' });
    } else {
      logger.error('run.failed', { code: err.code, message: err.message });
      throw err;
    }
  }

  const result: RunResult = {
    runId,
    ok,
    answer,
    stage,
    steps: step,
    stepBudget,
    outcomeId: outcome.id,
    profile,
    gateFindings,
    observations,
    messages,
    artifactCount: artifacts.all().length,
    usage,
    modelsUsed: [...modelsUsed],
    protocolDowngraded,
    sandboxDescriptors,
    ...(pendingQuestion ? { pendingQuestion } : {}),
    runDir: dir,
  };

  // The whole record, not chosen fields: run.json holds the request, the answer, tool
  // observation summaries and gate details, and any of them can carry something a person
  // pasted. This is the file the panel reads and the one someone attaches to a bug report,
  // so it is redacted as a unit — a field-by-field list is a thing to forget to update.
  await writeRunRecord(path.join(dir, 'run.json'), {
    runId,
    startedAt: new Date(started).toISOString(),
    finishedAt: utcStamp(),
    durationMs: Date.now() - started,
    request: opts.request,
    workspace: { slug, root: opts.workspaceRoot },
    profile,
    // ADR-0007 §6: who caused a run with nobody watching. Absent means a person ran it.
    ...(opts.trigger ? { trigger: opts.trigger } : {}),
    route: decision,
    // Flat, not just nested inside `route` — analytics reads this field, and without it
    // every run showed up as an unknown outcome. [Seen in a live run record, 2026-08-14.]
    outcomeId: outcome.id,
    // Which version of which skill was loaded is the first question when a run misbehaves.
    skillVersions: Object.fromEntries(skills.map((s) => [s.id, s.version])),
    ruleVersions: Object.fromEntries(opts.registry.rules.map((r) => [r.id, r.version])),
    allowlist: [...allowlist],
    droppedTools: dropped,
    steps: step,
    stepBudget,
    stage,
    ok,
    answer,
    gateFindings,
    observations,
    usage,
    modelsUsed: [...modelsUsed],
    protocolDowngraded,
    sandboxDescriptors,
    lessonIds: composed.lessonIds,
    conservative,
  });
  // The counterpart to run.started. Without it a run that died between the last step and
  // the run record was indistinguishable from one that finished quietly — reconstruction
  // question 10, "did this complete, partially complete, or silently do nothing".
  logger.info('run.completed', {
    ok,
    stage,
    steps: step,
    stepBudget,
    outcomeId: outcome.id,
    durationMs: Date.now() - started,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    models: [...modelsUsed],
    gatesFailed: gateFindings.filter((f) => !f.passed).length,
    toolCalls: observations.length,
    toolFailures: observations.filter((o) => !o.ok).length,
    paused: Boolean(pendingQuestion),
    protocolDowngraded,
    // Non-zero means this run's own telemetry is incomplete, and says so rather than
    // letting a partial trail read as a complete one.
    recordsDropped: droppedRecords(),
  });
  await auditQuietly({
    action: 'run.finished',
    actor: opts.trigger?.actor ?? 'local',
    source: opts.trigger?.kind ?? 'cli',
    subject: slug,
    outcome: ok ? 'allowed' : 'failed',
    runId,
    detail: { steps: step, durationMs: Date.now() - started, paused: Boolean(pendingQuestion) },
  });
  await logger.flush();

  emit({ type: 'answer', message: answer });
  return result;
}

/**
 * One provider call, and the record that makes it reconstructable.
 *
 * Before this, `src/providers/` emitted nothing at all: not one record in the store named
 * a model call. The tokens existed — every adapter returns `Usage`, normalised — but they
 * were folded straight into the run total, so per-call cost, latency and finish reason
 * were unrecoverable the moment the call returned. "How long did each step take, including
 * every model call" and "what did the model return" were both unanswerable, and cost could
 * only ever be attributed to a whole run.
 *
 * Emitted here at the engine's boundary rather than inside each of the five adapters: the
 * shape is identical for all of them, the run's logger is already in scope, and an adapter
 * that forgot to instrument itself would be a silent gap rather than a compile error.
 *
 * Deliberately not logged: the prompt and the completion. Those carry whatever the person
 * typed and whatever the tools read, and they belong in the separately governed transcript
 * (see `writeTranscript`), not in the operational record. `contextChars` and the token
 * counts say how big they were, which is what an operational reader actually needs.
 */
async function callModel(
  logger: Logger,
  call: () => Promise<ChatResponse>,
  ctx: {
    purpose: 'step' | 'reflector';
    providerId: string;
    model: string;
    tier: Tier;
    step?: number;
    stage?: Stage;
    contextChars?: number;
    toolsOffered: number;
  },
): Promise<ChatResponse> {
  const started = Date.now();
  try {
    const response = await call();
    logger.info('model.call', {
      purpose: ctx.purpose,
      providerId: ctx.providerId,
      // The exact variant the provider says it served, which is not always the one asked
      // for — an alias resolving to a different snapshot is worth seeing in the record.
      model: ctx.model,
      modelServed: response.model,
      tier: ctx.tier,
      ...(ctx.step !== undefined ? { step: ctx.step } : {}),
      ...(ctx.stage ? { stage: ctx.stage } : {}),
      ...(ctx.contextChars !== undefined ? { contextChars: ctx.contextChars } : {}),
      inputTokens: response.usage.inputTokens ?? null,
      outputTokens: response.usage.outputTokens ?? null,
      cacheReadTokens: response.usage.cacheReadTokens ?? null,
      cacheWriteTokens: response.usage.cacheWriteTokens ?? null,
      latencyMs: response.latencyMs || Date.now() - started,
      stopReason: response.stopReason,
      protocolUsed: response.protocolUsed,
      toolsOffered: ctx.toolsOffered,
      toolsInvoked: response.toolCalls.map((c) => c.name),
      outputChars: response.text.length,
    });
    return response;
  } catch (e) {
    // The failure path is the one that matters and the one that was least logged. A
    // provider call that threw previously left nothing behind at this level at all.
    const err = toHatsError(e);
    logger.error('model.call.failed', {
      purpose: ctx.purpose,
      providerId: ctx.providerId,
      model: ctx.model,
      tier: ctx.tier,
      ...(ctx.step !== undefined ? { step: ctx.step } : {}),
      ...(ctx.stage ? { stage: ctx.stage } : {}),
      ...(ctx.contextChars !== undefined ? { contextChars: ctx.contextChars } : {}),
      latencyMs: Date.now() - started,
      code: err.code,
      error: err.message,
    });
    throw e;
  }
}

/**
 * Writes the run record with credential shapes stripped.
 *
 * Serialise, redact, re-parse: it costs one extra pass over a file that is written once
 * per run, and it cannot miss a field that someone adds to the record later.
 */
async function writeRunRecord(file: string, record: unknown): Promise<void> {
  await writeJsonAtomic(file, JSON.parse(redactSecrets(JSON.stringify(record))));
}

async function executeCall(
  executor: Executor,
  call: ToolCall,
  allowlist: Set<string>,
  emit: (e: RunEvent) => void,
): Promise<ToolObservation> {
  // Sandbox code is carried on the event so the panel can show what actually ran.
  // Everything else about a sandbox call — the descriptor, the artifacts it was handed —
  // is already legible in the summary; the code was the one part that existed only inside
  // the run record, and it is the part someone reading the answer most wants to check.
  const code = call.name === 'sandbox_run' ? String((call.args as Record<string, unknown>)['code'] ?? '') : '';
  emit({
    type: 'tool',
    message: `${call.name}(${summariseArgs(call.args)})`,
    data: { tool: call.name, ...(code ? { code } : {}) },
  });
  const observation = await executor.execute(call, { allowlist });
  emit({
    type: 'tool',
    message: `  -> ${observation.ok ? 'ok' : 'denied'} ${firstLine(observation.summary)}`,
    data: {
      tool: call.name,
      ok: observation.ok,
      ...(code ? { output: observation.summary, artifactId: observation.artifactId } : {}),
    },
  });
  return observation;
}

/**
 * The delivery gate. Blocks once and forces a correction; after that the answer ships
 * with the gap disclosed rather than retrying forever (paper's bounded recovery).
 */
async function settle(
  draft: string,
  findings: GateFinding[],
  recoveries: number,
  record: (m: Message, internal?: boolean) => Promise<void>,
  emit: (e: RunEvent) => void,
  logger: Logger,
): Promise<{ retry: boolean; answer: string }> {
  const failed = findings.filter((f) => !f.passed);
  for (const f of findings) {
    logger.info('run.gate', { gate: f.gate, ruleId: f.ruleId, passed: f.passed, detail: f.detail });
  }
  if (failed.length === 0) return { retry: false, answer: draft };

  emit({
    type: 'gate',
    message: `blocked: ${failed.map((f) => `${f.ruleId} (${f.detail})`).join('; ')}`,
  });

  if (recoveries < MAX_GATE_RECOVERIES) {
    await record({ role: 'user', content: renderGateFeedback(findings) }, true);
    return { retry: true, answer: '' };
  }
  emit({ type: 'gate', message: 'recovery spent — delivering with the gap disclosed' });
  return { retry: false, answer: draft + renderGateDisclosure(findings) };
}

async function reflectorPass(input: {
  registry: Registry;
  pool: ProviderPool;
  config: HatsConfig;
  outcome: Skill;
  messages: Message[];
  record: (m: Message, internal?: boolean) => Promise<void>;
  logger: Logger;
  workspaceRoot: string;
  profile: Profile;
  memoryBlock: string;
  signal?: AbortSignal;
}): Promise<string> {
  const reflector = input.registry.behavioural().find((s) => s.role === 'reflector');
  const bound = input.pool.resolve('frontier');
  const system = buildSystemPrompt({
    skills: [input.outcome],
    ...(reflector ? { hat: reflector } : {}),
    rules: input.registry.rulesInScope({ stage: 'deliver', profile: input.profile }),
    memoryBlock: input.memoryBlock,
    workspaceRoot: input.workspaceRoot,
    profile: input.profile,
    stage: 'deliver',
    stepsLeft: 0,
    conservative: false,
  });
  const response = await callModel(
    input.logger,
    () =>
      bound.provider.chat({
        model: bound.model,
        system,
        messages: [
          ...input.messages,
          {
            role: 'user',
            content:
              'The step budget is spent. Deliver the best answer the evidence above supports, state plainly what remains unknown and why, and do not request more tools.',
          },
        ],
        tools: [],
        temperature: 0.2,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    {
      purpose: 'reflector',
      providerId: bound.providerId,
      model: bound.model,
      tier: 'frontier',
      toolsOffered: 0,
    },
  );
  input.logger.info('run.reflector', { chars: response.text.length });
  await input.record({ role: 'assistant', content: response.text });
  return response.text.trim();
}

export function advanceStage(
  prev: Stage,
  o: { usedTools: boolean; discoveryCount: number; hasPlanStage: boolean; planned: boolean },
): Stage {
  if (!o.usedTools) return 'verify';
  switch (prev) {
    case 'intake':
      return 'discover';
    case 'discover':
      return o.hasPlanStage && !o.planned && o.discoveryCount >= 1 ? 'plan' : 'act';
    case 'plan':
      return 'act';
    case 'verify':
      return 'act';
    default:
      return prev;
  }
}

function parseVerdict(role: string, text: string): { role: string; verdict: string; detail: string } {
  const m = /\b(PASS|FAIL|REVISE|STOP|DELIVER)\b/i.exec(text);
  const raw = (m?.[1] ?? '').toUpperCase();
  const verdict = raw === 'DELIVER' ? 'PASS' : raw || (/(problem|wrong|missing|unsupported)/i.test(text) ? 'FAIL' : 'PASS');
  return { role, verdict, detail: text };
}

function lastAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant' && m.content.trim()) return m.content;
  }
  return '';
}

/**
 * The draft the review was about: the last assistant text that is not itself a verdict.
 *
 * Excluding only the exact verdict string is not enough. A review that fails once sends the
 * model back to `act`, and if it answers with another verdict rather than a new draft, the
 * next PASS delivers *that* earlier verdict as the answer — the user gets "PASS. The draft
 * is ready to deliver" instead of the draft. [Seen in a live scheduled run, 2026-08-14.]
 */
function lastAssistantTextBefore(messages: Message[], exclude: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const text = m.content.trim();
    if (!text || text === exclude.trim() || looksLikeVerdict(text)) continue;
    return m.content;
  }
  return exclude;
}

/**
 * Verdict-shaped: the first non-empty line is just the verdict word, allowing for the
 * bold and punctuation models add. Deliberately narrow — a real answer that merely
 * contains "PASS" further down must not be mistaken for one.
 */
function looksLikeVerdict(text: string): boolean {
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  return /^[*_#\s]*(PASS|FAIL|REVISE|STOP|DELIVER)[*_\s.:!—-]*$/i.test(first);
}

function summariseArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args ?? {}).map(([k, v]) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}=${(s ?? '').slice(0, 40)}`;
  });
  return parts.join(', ').slice(0, 120);
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.slice(0, 140);
}

export { isHatsError };

/** Exposed for the regression test; not part of the runtime surface. */
export { looksLikeVerdict as looksLikeVerdictForTest };
