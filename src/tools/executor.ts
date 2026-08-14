/**
 * THE EXECUTOR. Paper §2.5, REPO_RULES §4.1.
 *
 * Every tool call in this runtime passes through `execute()`. Nothing else may reach a
 * handler. The order of checks below is the security model, and it is deliberately
 * boring: registry, allowlist, profile, network, schema, gates, approval, timeout,
 * shaping, audit.
 *
 * Denials are returned to the model as observations rather than thrown, because a model
 * that can see "denied: rule/allowlist-intersection" reasons its way to a legal action,
 * while a model that sees a crash retries the same illegal one.
 */

import { HatsError, toHatsError } from '../core/errors.js';
import type { Profile } from '../core/config.js';
import type { ToolCall } from '../providers/types.js';
import { shapeText } from './artifacts.js';
import { validateInput } from './validate.js';
import type { ToolContext, ToolHandler, ToolObservation } from './types.js';

const PROFILE_RANK: Record<Profile, number> = { 'read-only': 0, assisted: 1, trusted: 2 };

export interface GateCheck {
  /** The rule id this check enforces — REPO_RULES §4.8: every block cites a rule. */
  ruleId: string;
  /** Named code path, matching the rule's `enforced_by`. */
  name: string;
  /** Return null to pass, or a reason to block. */
  check(call: ToolCall, ctx: ToolContext): Promise<string | null> | string | null;
}

export interface ExecuteOptions {
  /** The composed allowlist for this step: skill ∩ profile ∩ registry. */
  allowlist: ReadonlySet<string>;
  /** Gate-strength rules registered at this workflow point. */
  gates?: GateCheck[];
  timeoutMs?: number;
}

export class Executor {
  constructor(
    private readonly handlers: Map<string, ToolHandler>,
    private readonly ctx: ToolContext,
  ) {}

  /** Tool schemas the model is shown: registry ∩ allowlist ∩ profile ∩ network state. */
  visibleTools(allowlist: ReadonlySet<string>): ToolHandler[] {
    const out: ToolHandler[] = [];
    for (const [name, handler] of this.handlers) {
      if (!allowlist.has(name)) continue;
      if (PROFILE_RANK[this.ctx.profile] < PROFILE_RANK[handler.spec.minProfile]) continue;
      if (handler.spec.network && !this.ctx.config.network.enabled) continue;
      if (
        handler.spec.availableWhen &&
        !handler.spec.availableWhen({
          profile: this.ctx.profile,
          networkEnabled: this.ctx.config.network.enabled,
        })
      ) {
        continue;
      }
      out.push(handler);
    }
    return out;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  async execute(call: ToolCall, opts: ExecuteOptions): Promise<ToolObservation> {
    const started = Date.now();
    const base = { callId: call.id, tool: call.name };

    this.ctx.logger.info('tool.call', {
      tool: call.name,
      callId: call.id,
      stage: this.ctx.stage,
      args: redactArgs(call.args),
    });

    try {
      // 1. Registry. An invented tool name stops here.
      const handler = this.handlers.get(call.name);
      if (!handler) {
        throw new HatsError(
          'TOOL_UNKNOWN',
          `no tool named "${call.name}" exists. Available: ${[...opts.allowlist].join(', ')}`,
          { tool: call.name },
          'rule/allowlist-intersection',
        );
      }

      // 2. Allowlist — intersection, never union.
      if (!opts.allowlist.has(call.name)) {
        throw new HatsError(
          'TOOL_NOT_ALLOWED',
          this.ctx.budgetExhausted
            ? `"${call.name}" is gone because the step budget is spent, not because it was ` +
              `forbidden. This is the final step: write the best answer the evidence you ` +
              `already have supports, say plainly what remains unknown, and stop.`
            : `"${call.name}" is not permitted by the active skill's allowlist`,
          { tool: call.name, allowed: [...opts.allowlist] },
          'rule/allowlist-intersection',
        );
      }

      // 3. Profile (ADR-0005). Absent from the surface, and refused if invented anyway.
      if (PROFILE_RANK[this.ctx.profile] < PROFILE_RANK[handler.spec.minProfile]) {
        throw new HatsError(
          'TOOL_NOT_ALLOWED',
          `"${call.name}" requires the "${handler.spec.minProfile}" profile; this run is "${this.ctx.profile}". Produce the change as text instead, or rerun with --profile ${handler.spec.minProfile}.`,
          { tool: call.name, profile: this.ctx.profile },
          'rule/profile-not-model-selectable',
        );
      }

      // 4. Network state.
      if (handler.spec.network && !this.ctx.config.network.enabled) {
        throw new HatsError(
          'NETWORK_DENIED',
          `"${call.name}" needs network egress, which is disabled`,
          { tool: call.name },
          'rule/network-off-by-default',
        );
      }

      // 5. Schema.
      const args = validateInput(
        call.name,
        handler.spec.parameters,
        call.args ?? {},
        handler.spec.passthroughInput === true,
      );

      // 6. Gate-strength rules registered at this point.
      for (const gate of opts.gates ?? []) {
        const reason = await gate.check(call, this.ctx);
        if (reason) {
          throw new HatsError(
            'GATE_BLOCKED',
            `blocked by ${gate.ruleId}: ${reason}`,
            { tool: call.name, gate: gate.name },
            gate.ruleId,
          );
        }
      }

      // 7. Approval, for mutating calls. Logged before execution, not after.
      if (handler.spec.mutating) {
        const approval = await this.requestApproval(call, args, handler);
        if (!approval) {
          // The advice has to be true for the situation. Telling an unattended run to "ask
          // what they want instead" sends it at a clarification that throws, and it then
          // loops until the budget runs out. [Seen in a live scheduled run, 2026-08-14.]
          throw new HatsError(
            'APPROVAL_DENIED',
            this.ctx.unattended
              ? `"${call.name}" cannot run: this is a scheduled or messaged run with nobody present to approve it, ` +
                `and no standing grant covers this call. Do not retry it and do not ask a question — nobody will see it. ` +
                `Finish by reporting what you would have done and what stopped you.`
              : `the human declined "${call.name}". Do not retry it; adjust the plan or ask what they want instead.`,
            { tool: call.name, ...(this.ctx.unattended ? { unattended: true } : {}) },
            'rule/mutation-requires-approval',
          );
        }
      }

      // 8. Execute under a wall-clock cap.
      const result = await withTimeout(
        handler.run(args, this.ctx),
        opts.timeoutMs ?? 120_000,
        call.name,
      );

      // 9. Shape the observation, store the whole thing (rule/tool-result-bounds).
      const max = handler.spec.maxSummaryChars ?? this.ctx.config.limits.maxToolOutputChars;
      const shaped = shapeText(
        result.summary,
        max,
        'The full result is stored as an artifact; narrow the request or compute over it in the sandbox.',
      );

      let artifactId = result.artifactId;
      if (!artifactId) {
        const artifact = await this.ctx.artifacts.put({
          kind: 'tool-result',
          tool: call.name,
          summary: shaped.summary,
          payload: result.payload ?? result.summary,
          provenance: { args: redactArgs(args), ...(result.provenance ?? {}) },
        });
        artifactId = artifact.id;
      }

      const observation: ToolObservation = {
        ...base,
        ok: !result.failed,
        summary: `[${artifactId}] ${shaped.summary}`,
        artifactId,
        durationMs: Date.now() - started,
      };

      this.ctx.logger.info('tool.result', {
        tool: call.name,
        callId: call.id,
        artifactId,
        ok: observation.ok,
        truncated: shaped.truncated,
        originalChars: shaped.originalChars,
        durationMs: observation.durationMs,
      });
      return observation;
    } catch (e) {
      const err = toHatsError(e, 'TOOL_FAILED');
      // Two conditions are not observations: a clarification pause is a loop state
      // (paper §2.2), and an interrupt is the user. Both must reach the caller.
      if (err.code === 'CLARIFICATION_REQUIRED' || err.code === 'INTERRUPTED') throw err;
      this.ctx.logger.warn('tool.denied', {
        tool: call.name,
        callId: call.id,
        code: err.code,
        ruleId: err.ruleId,
        message: err.message,
      });
      const observation: ToolObservation = {
        ...base,
        ok: false,
        summary: err.ruleId
          ? `DENIED (${err.code}, ${err.ruleId}): ${err.message}`
          : `FAILED (${err.code}): ${err.message}`,
        errorCode: err.code,
        durationMs: Date.now() - started,
      };
      if (err.ruleId) observation.ruleId = err.ruleId;
      return observation;
    }
  }

  private async requestApproval(
    call: ToolCall,
    args: Record<string, unknown>,
    handler: ToolHandler,
  ): Promise<boolean> {
    const detail = describeMutation(call.name, args);
    // The audit entry precedes execution: a command that destroys its own evidence still
    // leaves a record of what was about to run (rule/mutation-requires-approval).
    this.ctx.logger.warn('tool.mutation.pending', {
      tool: call.name,
      callId: call.id,
      profile: this.ctx.profile,
      detail: detail.slice(0, 4_000),
    });
    if (this.ctx.profile === 'trusted') return true;

    // A handler may know something about the call that the arguments do not carry — which
    // page is open, which host is connected. Failing to produce it must not block the
    // approval, only narrow what a grant can match.
    let scope: Record<string, unknown> | undefined;
    try {
      scope = await handler.scopeFacts?.(args, this.ctx);
    } catch {
      scope = undefined;
    }

    return this.ctx.approve({
      tool: call.name,
      headline: `${call.name}: ${handler.spec.description.split('.')[0] ?? ''}`,
      detail,
      // Validated args, so a standing grant can be scoped to this call rather than to the
      // tool's name (ADR-0009). Passed after schema validation, never raw model output.
      args,
      ...(scope ? { scope } : {}),
    });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, tool: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new HatsError('TOOL_TIMEOUT', `${tool} exceeded ${ms}ms`, { tool })),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeMutation(tool: string, args: Record<string, unknown>): string {
  if (tool === 'run_command') return String(args['command'] ?? '');
  if (tool === 'write_file') {
    const content = String(args['content'] ?? '');
    return `path: ${String(args['path'] ?? '')}\n${content.length} bytes\n---\n${content.slice(0, 2_000)}`;
  }
  if (tool === 'apply_patch') {
    return `path: ${String(args['path'] ?? '')}\n--- find ---\n${String(args['find'] ?? '').slice(0, 800)}\n--- replace ---\n${String(args['replace'] ?? '').slice(0, 800)}`;
  }
  return JSON.stringify(args, null, 2).slice(0, 2_000);
}

/** Long argument values are elided in logs; nothing is dropped from artifacts. */
function redactArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…(${v.length})` : v;
  }
  return out;
}
