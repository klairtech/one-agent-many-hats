/**
 * An inbound message channel. This is the one surface in the system where an instruction
 * arrives from outside the machine, so the boundary is stated here rather than left to
 * each transport.
 *
 * A transport's job is only to move bytes: poll for messages, send a reply. It does not
 * decide who is allowed to talk, what profile a run gets, or whether a tool may fire.
 * `ChannelManager` does all of that, so adding a transport cannot widen the boundary by
 * forgetting a check.
 */

import type { Profile } from '../core/config.js';

export interface InboundMessage {
  /** Transport-unique. Used to avoid handling the same message twice after a restart. */
  id: string;
  /** Sender identity as the transport knows it — a chat id, a filename. */
  from: string;
  /** Display name, for the audit trail. Never used for authorisation. */
  fromName?: string;
  text: string;
  receivedAt: string;
}

export interface ChannelTransport {
  readonly id: string;
  readonly kind: string;
  /** Returns messages received since the last poll. Must not return one twice. */
  poll(signal?: AbortSignal): Promise<InboundMessage[]>;
  send(to: string, text: string): Promise<void>;
  /** Called once before the first poll, for credential checks that should fail loudly. */
  check?(): Promise<void>;
}

export interface ChannelConfig {
  kind: 'telegram' | 'local';
  enabled?: boolean;
  /**
   * Senders permitted to drive the agent. There is no wildcard: an empty list means the
   * channel accepts nothing, which is the correct default for a surface that lets a remote
   * party run an agent on your machine.
   */
  allowFrom: string[];
  /** Workspace scheduled runs from this channel operate in. */
  workspace?: string;
  /** ADR-0007: read-only or assisted. `trusted` is refused. */
  profile?: Profile;
  /** Tools pre-authorised to run without a prompt, per ADR-0007 §4. */
  allowTools?: string[];
  /** Local transport only: the directory watched for message files. */
  dir?: string;
  /** Telegram only: env var holding the bot token, if not in credentials.json. */
  tokenEnv?: string;
}
