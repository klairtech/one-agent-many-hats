/**
 * Telegram via the Bot API.
 *
 * Chosen over WhatsApp and Discord for one reason: it is the only mainstream messenger
 * reachable with plain HTTPS long-polling, so it needs no dependency, no inbound port, no
 * webhook and no tunnel. `getUpdates` holds the connection open until something arrives.
 * WhatsApp would mean either a paid Business API or a reverse-engineered client, and
 * neither belongs in a zero-dependency local tool.
 *
 * The bot token is a credential and lives in credentials.json at mode 0600, never in
 * config.json (REPO_RULES §5). It is never logged or returned by any API.
 *
 * Two Telegram behaviours worth knowing, because they are security-relevant and easy to
 * miss: a bot can be added to a group by anyone who has its username, and `chat.id` for a
 * group is not the sender's id. Both are handled by authorising on `from.id` — the human —
 * and never on `chat.id`.
 */

import path from 'node:path';

import { HatsError } from '../core/errors.js';
import { channelStateDir } from '../core/paths.js';
import { ensureDir, readJson, writeJsonAtomic } from '../core/store.js';
import { requestJson } from '../providers/http.js';
import type { ChannelTransport, InboundMessage } from './types.js';

const API = 'https://api.telegram.org';
/** Long-poll window. Telegram holds the request open this long before returning empty. */
const POLL_SECONDS = 25;

interface Update {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id?: number; first_name?: string; username?: string; is_bot?: boolean };
    chat?: { id?: number; type?: string };
  };
}

export class TelegramChannel implements ChannelTransport {
  readonly kind = 'telegram';
  private offset = 0;
  private loaded = false;
  /** from.id -> chat.id, so a reply goes where the message came from. */
  private readonly replyTo = new Map<string, string>();

  constructor(
    readonly id: string,
    private readonly token: string,
  ) {}

  private url(method: string): string {
    return `${API}/bot${this.token}/${method}`;
  }

  private statePath(): string {
    return path.join(channelStateDir(), `${this.id}.json`);
  }

  async check(): Promise<void> {
    const me = await requestJson<{ ok?: boolean; result?: { username?: string } }>(
      this.url('getMe'),
      { method: 'GET', providerId: `channel:${this.id}`, retries: 1, timeoutMs: 20_000 },
    );
    if (!me.ok) {
      throw new HatsError('PROVIDER_UNAUTHORIZED', `${this.id}: Telegram rejected the bot token`, {
        channel: this.id,
      });
    }
  }

  private async loadOffset(): Promise<void> {
    if (this.loaded) return;
    const state = await readJson<{ offset?: number }>(this.statePath(), {});
    this.offset = state.offset ?? 0;
    this.loaded = true;
  }

  async poll(signal?: AbortSignal): Promise<InboundMessage[]> {
    await this.loadOffset();
    const res = await requestJson<{ ok?: boolean; result?: Update[]; description?: string }>(
      this.url('getUpdates'),
      {
        method: 'GET',
        providerId: `channel:${this.id}`,
        retries: 0,
        // Must exceed the long-poll window or every poll aborts just before returning.
        timeoutMs: (POLL_SECONDS + 10) * 1_000,
        ...(signal ? { signal } : {}),
      },
    );
    if (!res.ok) {
      throw new HatsError('PROVIDER_ERROR', `${this.id}: ${res.description ?? 'getUpdates failed'}`, {});
    }

    const updates = res.result ?? [];
    const out: InboundMessage[] = [];
    for (const u of updates) {
      // Acknowledged by advancing the offset whether or not we act on it, so an ignored
      // message from a stranger is not re-fetched forever.
      this.offset = Math.max(this.offset, u.update_id + 1);
      const m = u.message;
      const fromId = m?.from?.id;
      if (!m?.text || fromId === undefined || m.from?.is_bot) continue;

      // Authorised on the human, never on the chat: adding the bot to a group must not
      // let the group drive it.
      const from = String(fromId);
      if (m.chat?.id !== undefined) this.replyTo.set(from, String(m.chat.id));
      out.push({
        id: `${u.update_id}`,
        from,
        ...(m.from?.username ?? m.from?.first_name
          ? { fromName: m.from?.username ?? m.from?.first_name }
          : {}),
        text: m.text.trim(),
        receivedAt: new Date().toISOString(),
      });
    }

    if (updates.length > 0) {
      await ensureDir(channelStateDir());
      await writeJsonAtomic(this.statePath(), { offset: this.offset });
    }
    return out;
  }

  async send(to: string, text: string): Promise<void> {
    const chatId = this.replyTo.get(to) ?? to;
    // Telegram rejects anything over 4096 characters outright, so a long answer would
    // otherwise be lost entirely rather than truncated.
    for (const chunk of splitForTelegram(text)) {
      await requestJson<{ ok?: boolean }>(this.url('sendMessage'), {
        providerId: `channel:${this.id}`,
        body: { chat_id: chatId, text: chunk, disable_web_page_preview: true },
        retries: 1,
        timeoutMs: 30_000,
      });
    }
  }
}

export function splitForTelegram(text: string, limit = 3_900): string[] {
  if (text.length <= limit) return [text || '(empty answer)'];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Prefer a paragraph or line boundary so a chunk does not split mid-sentence.
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
    const at = cut > limit * 0.5 ? cut : limit;
    chunks.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
