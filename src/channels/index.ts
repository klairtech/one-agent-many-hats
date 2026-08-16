/**
 * The inbound boundary.
 *
 * Every message from every transport passes through `handle()`, and the order there is
 * deliberate and mirrors the executor's: identify, authorise, then act. A transport can
 * only deliver bytes; it cannot decide that a sender is allowed.
 *
 * An inbound message is an unattended run even though a human sent it, because no human is
 * at the approval prompt when a tool fires. The sender asked a question; they cannot see
 * what the agent is about to do with it. ADR-0007 applies unchanged.
 */

import { Logger, runtimeLogger } from '../core/logger.js';
import { auditQuietly } from '../core/audit.js';
import { toHatsError } from '../core/errors.js';
import { getCredential } from '../core/credentials.js';
import { channelStateDir } from '../core/paths.js';
import path from 'node:path';
import type { HatsConfig } from '../core/config.js';
import { runUnattended } from '../schedule/runner.js';
import { assertUnattendedProfile, summariseDecisions, type Trigger, type UnattendedDecision } from '../schedule/unattended.js';
import { RemoteApprovals } from './approve.js';
import { LocalChannel } from './local.js';
import { TelegramChannel } from './telegram.js';
import type { ChannelConfig, ChannelTransport, InboundMessage } from './types.js';

export type { ChannelConfig, ChannelTransport, InboundMessage };

export interface HandledMessage {
  channel: string;
  from: string;
  ok: boolean;
  /** False when the sender was not on the allowlist. Nothing ran. */
  authorised: boolean;
  request: string;
  answer: string;
  runId?: string;
  decisions: UnattendedDecision[];
  error?: string;
}

export class ChannelManager {
  private readonly transports = new Map<string, { transport: ChannelTransport; cfg: ChannelConfig }>();
  private polling = false;
  /** Outstanding "reply yes ABCD" requests from unattended runs (ADR-0009 §2). */
  readonly approvals = new RemoteApprovals();

  constructor(
    private readonly config: HatsConfig,
    private readonly defaultWorkspace: string,
    private readonly logger: Logger = runtimeLogger('channel'),
  ) {}

  /**
   * Builds the configured transports. A channel with an empty allowlist is refused at
   * startup rather than started and left accepting nothing — silently doing nothing is
   * indistinguishable from being broken.
   */
  async start(): Promise<string[]> {
    const configured = this.config.channels ?? {};
    const started: string[] = [];

    for (const [id, cfg] of Object.entries(configured)) {
      if (cfg.enabled === false) continue;
      if (!cfg.allowFrom || cfg.allowFrom.length === 0) {
        this.logger.warn('channel.start.refused', {
          reason: 'allowFrom is empty',
          channel: id,
          hint: 'add the sender ids permitted to drive the agent; there is no wildcard',
        });
        continue;
      }
      assertUnattendedProfile(cfg.profile ?? 'read-only');

      let transport: ChannelTransport;
      if (cfg.kind === 'telegram') {
        const token =
          getCredential(`channel:${id}`) ?? (cfg.tokenEnv ? process.env[cfg.tokenEnv] : undefined);
        if (!token) {
          this.logger.warn('channel.start.refused', {
            reason: 'no bot token',
            channel: id,
            hint: `run: hats channel token ${id}`,
          });
          continue;
        }
        transport = new TelegramChannel(id, token);
      } else {
        transport = new LocalChannel(id, cfg.dir ?? path.join(channelStateDir(), id));
      }

      try {
        await transport.check?.();
      } catch (e) {
        this.logger.warn('channel.start.failed', {
          channel: id,
          code: toHatsError(e).code,
          error: toHatsError(e).message,
        });
        continue;
      }
      this.transports.set(id, { transport, cfg });
      started.push(id);
    }
    return started;
  }

  list(): Array<{ id: string; kind: string; allowFrom: number; profile: string }> {
    return [...this.transports.entries()].map(([id, { transport, cfg }]) => ({
      id,
      kind: transport.kind,
      allowFrom: cfg.allowFrom.length,
      profile: cfg.profile ?? 'read-only',
    }));
  }

  /** One poll of every transport, handling whatever arrived. */
  async tick(signal?: AbortSignal): Promise<HandledMessage[]> {
    if (this.polling) return [];
    this.polling = true;
    const out: HandledMessage[] = [];
    try {
      for (const [id, { transport, cfg }] of this.transports) {
        let messages: InboundMessage[];
        try {
          messages = await transport.poll(signal);
        } catch (e) {
          this.logger.warn('channel.poll.failed', {
            channel: id,
            code: toHatsError(e).code,
            error: toHatsError(e).message,
          });
          continue;
        }
        for (const message of messages) {
          out.push(await this.handle(id, transport, cfg, message));
        }
      }
    } finally {
      this.polling = false;
    }
    return out;
  }

  async handle(
    channelId: string,
    transport: ChannelTransport,
    cfg: ChannelConfig,
    message: InboundMessage,
  ): Promise<HandledMessage> {
    const base = {
      channel: channelId,
      from: message.from,
      request: message.text,
      decisions: [] as UnattendedDecision[],
    };

    // Authorisation first, before the text is used for anything at all. An unknown sender
    // gets no reply: answering would confirm the bot exists and is listening, and there is
    // no version of that which helps the owner.
    if (!cfg.allowFrom.includes(message.from)) {
      this.logger.warn('channel.message.rejected', {
        channel: channelId,
        from: message.from,
        name: message.fromName,
      });
      // A rejected sender is an accountability event, not a debugging one: it is the
      // question "who tried to drive this agent and was refused" that arrives later, and
      // it cannot live only in an application log that ages out.
      await auditQuietly({
        action: 'auth.rejected',
        actor: message.from,
        source: `channel:${channelId}`,
        subject: cfg.workspace ?? this.defaultWorkspace,
        outcome: 'denied',
        detail: { reason: 'sender not in allowFrom', name: message.fromName },
      });
      return { ...base, ok: false, authorised: false, answer: '' };
    }

    // "yes A3F1" is an answer, not a new task. Only reached once the sender is allowlisted.
    if (this.approvals.tryAnswer(message.from, message.text)) {
      this.logger.info('channel.approval.answered', { channel: channelId, from: message.from });
      return { ...base, ok: true, authorised: true, answer: '' };
    }

    const profile = cfg.profile ?? 'read-only';
    const trigger: Trigger = {
      kind: 'message',
      id: `${channelId}:${message.id}`,
      actor: message.fromName ? `${message.fromName} (${message.from})` : message.from,
    };
    const decisions: UnattendedDecision[] = [];

    this.logger.info('channel.message.accepted', {
      channel: channelId,
      from: message.from,
      profile,
      workspace: cfg.workspace ?? this.defaultWorkspace,
      messageId: message.id,
    });
    await auditQuietly({
      action: 'auth.accepted',
      actor: trigger.actor,
      source: `channel:${channelId}`,
      subject: cfg.workspace ?? this.defaultWorkspace,
      outcome: 'allowed',
      detail: { profile, messageId: message.id },
    });

    try {
      const result = await runUnattended({
        request: message.text,
        workspace: cfg.workspace ?? this.defaultWorkspace,
        profile,
        allowTools: cfg.allowTools ?? [],
        trigger,
        decisions,
        // The sender is reachable by definition — they just messaged us — so a mutation
        // no grant covers can be put to them rather than silently denied.
        askHuman: (req) =>
          this.approvals.ask(
            transport,
            message.from,
            req,
            trigger,
            cfg.workspace ?? this.defaultWorkspace,
          ),
      });

      const note = summariseDecisions(decisions);
      const reply = note ? `${result.answer}\n\n---\n${note}` : result.answer;
      await transport.send(message.from, reply);
      return {
        ...base,
        decisions,
        ok: result.ok,
        authorised: true,
        answer: result.answer,
        runId: result.runId,
      };
    } catch (e) {
      const err = toHatsError(e);
      // The sender is authorised, so they get told it failed. The detail is deliberately
      // the message and not the stack — a stack over a messenger is an information leak.
      await transport
        .send(message.from, `That run did not finish: ${err.message}`)
        .catch(() => undefined);
      return {
        ...base,
        decisions,
        ok: false,
        authorised: true,
        answer: '',
        error: `${err.code}: ${err.message}`,
      };
    }
  }

  /** Used by the scheduler's notify option to deliver a result. */
  async deliver(channelId: string, to: string, text: string): Promise<void> {
    const entry = this.transports.get(channelId);
    if (!entry) throw new Error(`channel "${channelId}" is not running`);
    await entry.transport.send(to, text);
  }
}
