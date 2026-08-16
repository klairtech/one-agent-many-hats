/**
 * Asking a human to approve something while nobody is at the keyboard (ADR-0009 §2).
 *
 * This is the honest version of "autonomous at 3am": the run acts because a person said
 * yes at 3am, not because nobody was there to say no. ADR-0007 named this as the right
 * long-term shape and did not build it; this is it.
 *
 * The rules that make it safe are small and all of them matter:
 *   - only the sender the request was addressed to may answer it
 *   - the answer must carry the request's own short code, so a stray "yes" in an unrelated
 *     message cannot approve anything
 *   - requests expire, and an expired request is a denial rather than a hang
 */

import { randomBytes } from 'node:crypto';

import { Logger, runtimeLogger } from '../core/logger.js';
import { auditQuietly } from '../core/audit.js';
import type { ApprovalRequest } from '../tools/types.js';
import type { Trigger } from '../schedule/unattended.js';
import type { ChannelTransport } from './types.js';

/** Long enough to wake up and read a phone; short enough that a run does not hang all night. */
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

interface Pending {
  code: string;
  tool: string;
  from: string;
  /** Whose data the pending mutation would touch; carried so the audit record has a subject. */
  workspace: string | null;
  resolve: (answer: { approved: boolean; by?: string; reason: string }) => void;
  timer: NodeJS.Timeout;
}

export class RemoteApprovals {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly logger: Logger = runtimeLogger('approve'),
    private readonly windowMs = DEFAULT_WINDOW_MS,
  ) {}

  get waiting(): number {
    return this.pending.size;
  }

  /**
   * Sends the request and waits. Resolves with a denial on timeout rather than throwing,
   * so the run continues and reports what it could not do.
   */
  async ask(
    transport: ChannelTransport,
    to: string,
    request: ApprovalRequest,
    trigger: Trigger,
    workspace: string | null = null,
  ): Promise<{ approved: boolean; by?: string; reason: string }> {
    // Short and unambiguous: four hex characters is enough to bind an answer to a request
    // without being something anyone has to type carefully at 3am.
    const code = randomBytes(2).toString('hex').toUpperCase();

    const message = [
      `Approval needed — ${trigger.kind} ${trigger.id}`,
      '',
      request.headline,
      '',
      truncate(request.detail, 1_200),
      '',
      `Reply "yes ${code}" to allow it, or "no ${code}" to refuse.`,
      `It will be refused on its own in ${Math.round(this.windowMs / 60_000)} minutes.`,
    ].join('\n');

    await transport.send(to, message);
    this.logger.warn('approval.asked', { tool: request.tool, to, code, trigger: trigger.id });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(code);
        this.logger.warn('approval.expired', { tool: request.tool, code });
        void transport
          .send(to, `Time is up on ${code} (${request.tool}) — it was refused.`)
          .catch(() => undefined);
        resolve({ approved: false, reason: `nobody answered within ${this.windowMs / 60_000} minutes` });
      }, this.windowMs);

      this.pending.set(code, { code, tool: request.tool, from: to, workspace, resolve, timer });
    });
  }

  /**
   * Offers an inbound message as an answer. Returns true when it was consumed, so the
   * caller knows not to treat it as a new request to run.
   */
  tryAnswer(from: string, text: string): boolean {
    const m = /^\s*(yes|no|y|n|approve|deny)\s+([0-9a-f]{4})\s*$/i.exec(text);
    if (!m) return false;
    const code = (m[2] ?? '').toUpperCase();
    const entry = this.pending.get(code);
    if (!entry) return false;

    // Bound to the sender it was asked of. Another allowlisted person cannot answer for them.
    if (entry.from !== from) {
      this.logger.warn('approval.wrong-sender', { code, from, expected: entry.from });
      // Someone allowlisted tried to approve a mutation put to a different person. That is
      // an authorisation decision and belongs in the accountability record.
      // `tryAnswer` is synchronous by contract, so this is dispatched rather than awaited:
      // the audit queue keeps the ordering, and only a process death loses the record.
      void auditQuietly({
        action: 'authz.denied',
        actor: from,
        source: 'channel',
        subject: entry.workspace,
        outcome: 'denied',
        detail: { reason: 'answered an approval addressed to another sender', tool: entry.tool },
      });
      return false;
    }

    const yes = /^(yes|y|approve)$/i.test(m[1] ?? '');
    clearTimeout(entry.timer);
    this.pending.delete(code);
    this.logger.warn('approval.answered', { tool: entry.tool, code, approved: yes, by: from });
    void auditQuietly({
      action: yes ? 'authz.granted' : 'authz.denied',
      actor: from,
      source: 'channel',
      subject: entry.workspace,
      outcome: yes ? 'allowed' : 'denied',
      detail: { tool: entry.tool, via: 'channel approval' },
    });
    entry.resolve({
      approved: yes,
      by: from,
      reason: yes ? `approved by ${from} over the channel` : `refused by ${from} over the channel`,
    });
    return true;
  }

  /** Denies everything outstanding. Used when the channel is shutting down. */
  cancelAll(reason = 'the channel stopped'): void {
    for (const [code, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, reason });
      this.pending.delete(code);
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
}
