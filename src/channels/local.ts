/**
 * A channel backed by files on disk.
 *
 * It exists for two reasons. It is the only way to exercise the whole inbound path —
 * allowlist, unattended policy, run, reply — without a bot token and a network round trip,
 * which is what makes the messaging front end testable. And it is a genuine integration
 * point: anything that can write a file can now talk to the agent, which covers shell
 * scripts, Shortcuts, Automator and any tool that drops a file somewhere.
 *
 * Layout under the channel directory:
 *   inbox/<name>.txt     a message, one per file. The sender is the part before the first
 *                        dot, so `sandeep.hello.txt` is from `sandeep`.
 *   handled/<name>.txt   moved here once read, so a restart does not re-run it.
 *   outbox/<name>.md     the reply.
 */

import path from 'node:path';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';

import { ensureDir, exists } from '../core/store.js';
import type { ChannelTransport, InboundMessage } from './types.js';

export class LocalChannel implements ChannelTransport {
  readonly kind = 'local';

  constructor(
    readonly id: string,
    private readonly dir: string,
  ) {}

  private inbox(): string {
    return path.join(this.dir, 'inbox');
  }
  private handled(): string {
    return path.join(this.dir, 'handled');
  }
  private outbox(): string {
    return path.join(this.dir, 'outbox');
  }

  async check(): Promise<void> {
    await ensureDir(this.inbox());
    await ensureDir(this.handled());
    await ensureDir(this.outbox());
  }

  async poll(): Promise<InboundMessage[]> {
    if (!(await exists(this.inbox()))) return [];
    const entries = (await readdir(this.inbox())).filter((f) => f.endsWith('.txt')).sort();

    const out: InboundMessage[] = [];
    for (const name of entries) {
      const full = path.join(this.inbox(), name);
      const text = await readFile(full, 'utf8').catch(() => '');
      // Moved before it is returned, not after it is handled: a message that crashes the
      // run must not be retried on every tick forever.
      await ensureDir(this.handled());
      await rename(full, path.join(this.handled(), name)).catch(() => undefined);
      if (!text.trim()) continue;
      out.push({
        id: name.replace(/\.txt$/, ''),
        from: name.split('.')[0] ?? name,
        text: text.trim(),
        receivedAt: new Date().toISOString(),
      });
    }
    return out;
  }

  async send(to: string, text: string): Promise<void> {
    await ensureDir(this.outbox());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(path.join(this.outbox(), `${to}.${stamp}.md`), text, 'utf8');
  }
}
