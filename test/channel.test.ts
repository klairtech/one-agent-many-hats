/**
 * The inbound channel is the only place an instruction arrives from off the machine, so
 * the tests here are about who is refused, not about whether a message gets through.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

import { ChannelManager } from '../src/channels/index.js';
import { LocalChannel } from '../src/channels/local.js';
import { splitForTelegram } from '../src/channels/telegram.js';
import type { ChannelConfig, ChannelTransport, InboundMessage } from '../src/channels/types.js';
import { cleanup, tempHome, testConfig } from './helpers.js';

/** Records what it was asked to send, so the manager's behaviour is observable. */
class FakeTransport implements ChannelTransport {
  readonly kind = 'fake';
  sent: Array<{ to: string; text: string }> = [];
  constructor(
    readonly id: string,
    private queue: InboundMessage[] = [],
  ) {}
  async poll(): Promise<InboundMessage[]> {
    const out = this.queue;
    this.queue = [];
    return out;
  }
  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }
}

function message(from: string, text = 'what changed today?'): InboundMessage {
  return { id: `m_${from}`, from, text, receivedAt: new Date().toISOString() };
}

test('a sender who is not on the allowlist gets no run and no reply', async () => {
  const home = await tempHome();
  try {
    const manager = new ChannelManager(testConfig(), '/tmp');
    const transport = new FakeTransport('tg');
    const cfg: ChannelConfig = { kind: 'telegram', allowFrom: ['12345'] };

    const handled = await manager.handle('tg', transport, cfg, message('99999'));

    assert.equal(handled.authorised, false);
    assert.equal(handled.ok, false);
    assert.equal(handled.runId, undefined, 'nothing ran');
    assert.equal(
      transport.sent.length,
      0,
      'a stranger must not get a reply — it confirms the bot is listening',
    );
  } finally {
    await cleanup(home);
  }
});

test('an empty allowlist means nobody is authorised', async () => {
  const home = await tempHome();
  try {
    const manager = new ChannelManager(testConfig(), '/tmp');
    const transport = new FakeTransport('tg');
    const cfg: ChannelConfig = { kind: 'telegram', allowFrom: [] };
    for (const from of ['', '0', 'anyone', '12345']) {
      const handled = await manager.handle('tg', transport, cfg, message(from));
      assert.equal(handled.authorised, false, `"${from}" was let through`);
    }
    assert.equal(transport.sent.length, 0);
  } finally {
    await cleanup(home);
  }
});

test('a channel with an empty allowlist is not started at all', async () => {
  const home = await tempHome();
  try {
    const config = testConfig();
    config.channels = {
      open: { kind: 'local', allowFrom: [] },
      shut: { kind: 'local', allowFrom: ['me'], enabled: false },
      fine: { kind: 'local', allowFrom: ['me'] },
    };
    const started = await new ChannelManager(config, '/tmp').start();
    assert.deepEqual(started, ['fine']);
  } finally {
    await cleanup(home);
  }
});

test('a channel cannot be configured to run unattended as trusted', async () => {
  const home = await tempHome();
  try {
    const config = testConfig();
    config.channels = { tg: { kind: 'local', allowFrom: ['me'], profile: 'trusted' } };
    await assert.rejects(() => new ChannelManager(config, '/tmp').start(), /trusted/);
  } finally {
    await cleanup(home);
  }
});

test('the local transport reads a message once and never again', async () => {
  const home = await tempHome();
  try {
    const dir = path.join(home, 'ch');
    const channel = new LocalChannel('files', dir);
    await channel.check();
    await mkdir(path.join(dir, 'inbox'), { recursive: true });
    await writeFile(path.join(dir, 'inbox', 'sandeep.first.txt'), 'how many tests are there?');
    await writeFile(path.join(dir, 'inbox', 'blank.txt'), '   ');

    const first = await channel.poll();
    assert.equal(first.length, 1, 'a blank message is not a message');
    assert.equal(first[0]?.from, 'sandeep');
    assert.equal(first[0]?.text, 'how many tests are there?');

    // The crucial one: a restart, or a crash mid-run, must not re-run it.
    assert.deepEqual(await channel.poll(), []);
    assert.ok((await readdir(path.join(dir, 'handled'))).includes('sandeep.first.txt'));

    await channel.send('sandeep', '121 tests');
    const outbox = await readdir(path.join(dir, 'outbox'));
    assert.equal(outbox.length, 1);
    assert.ok(outbox[0]?.startsWith('sandeep.'));
  } finally {
    await cleanup(home);
  }
});

test('a long answer is split rather than silently dropped by Telegram', () => {
  const short = splitForTelegram('hello');
  assert.deepEqual(short, ['hello']);

  const long = 'para\n\n'.repeat(2_000);
  const chunks = splitForTelegram(long);
  assert.ok(chunks.length > 1, 'expected a split');
  for (const c of chunks) assert.ok(c.length <= 3_900, `chunk was ${c.length}`);
  // Nothing may be lost in the split.
  assert.equal(chunks.join('\n\n').replace(/\s+/g, ''), long.replace(/\s+/g, ''));

  // An empty answer still has to send something Telegram will accept.
  assert.deepEqual(splitForTelegram(''), ['(empty answer)']);
});
