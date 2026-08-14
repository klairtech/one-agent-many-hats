/**
 * `hats channel` — the inbound message surface.
 *
 * `serve` is the long-running half: it polls each configured channel and runs whatever an
 * allowlisted sender asks for. It refuses to start a channel with an empty allowlist, so
 * "it is running but ignores me" is never the silent default state.
 */

import path from 'node:path';

import { loadConfig } from '../core/config.js';
import { setCredential, getCredential, credentialHint } from '../core/credentials.js';
import { channelStateDir } from '../core/paths.js';
import { toHatsError } from '../core/errors.js';
import { ChannelManager } from '../channels/index.js';
import { createPrompter } from './render.js';
import { out, paint } from './render.js';

type Flags = Record<string, string | boolean>;

export async function channelCommand(positional: string[], flags: Flags): Promise<number> {
  const sub = positional[0] ?? 'list';
  switch (sub) {
    case 'list':
    case 'ls':
      return list();
    case 'token':
      return token(positional[1]);
    case 'serve':
      return serve(flags);
    default:
      out.fail(`unknown: hats channel ${sub}`);
      usage();
      return 1;
  }
}

function usage(): void {
  out.line(`
  hats channel list                what is configured, and whether it can start
  hats channel token <id>          store a bot token (prompted, never echoed)
  hats channel serve               poll and answer until interrupted

  ${paint('Channels are opt-in and off by default. Configure one in config.json:', 'grey')}

    "channels": {
      "tg": { "kind": "telegram", "allowFrom": ["<your numeric telegram user id>"],
              "profile": "read-only" },
      "files": { "kind": "local", "allowFrom": ["me"] }
    }

  ${paint('allowFrom has no wildcard. An empty list means the channel accepts nothing, which', 'grey')}
  ${paint('is the right default for a surface that lets someone run an agent on your machine.', 'grey')}
  ${paint('An inbound message is an unattended run: read-only unless you set profile and name', 'grey')}
  ${paint('tools in allowTools (ADR-0007).', 'grey')}
`);
}

async function list(): Promise<number> {
  const config = await loadConfig();
  const configured = Object.entries(config.channels ?? {});
  if (configured.length === 0) {
    out.dim('no channels configured');
    usage();
    return 0;
  }

  out.table(
    configured.map(([id, cfg]) => {
      const problems: string[] = [];
      if (cfg.enabled === false) problems.push('disabled');
      if (!cfg.allowFrom?.length) problems.push('allowFrom is empty — nothing can talk to it');
      if (cfg.kind === 'telegram' && !getCredential(`channel:${id}`) && !cfg.tokenEnv) {
        problems.push(`no token — hats channel token ${id}`);
      }
      return [
        paint(id, 'grey'),
        cfg.kind,
        String(cfg.allowFrom?.length ?? 0),
        cfg.profile ?? 'read-only',
        cfg.allowTools?.length ? cfg.allowTools.join(',') : paint('nothing', 'grey'),
        problems.length ? paint(problems.join('; '), 'yellow') : paint('ready', 'green'),
      ];
    }),
    ['id', 'kind', 'senders', 'profile', 'may write', 'state'],
  );

  for (const [id, cfg] of configured) {
    if (cfg.kind === 'telegram') {
      const hint = credentialHint(getCredential(`channel:${id}`));
      if (hint) out.keyValue(`${id} token`, hint);
    } else {
      out.keyValue(`${id} inbox`, path.join(cfg.dir ?? path.join(channelStateDir(), id), 'inbox'));
    }
  }
  return 0;
}

async function token(id: string | undefined): Promise<number> {
  if (!id) {
    out.fail('usage: hats channel token <channel-id>');
    return 1;
  }
  const prompter = createPrompter();
  try {
    const value = await prompter.secret(`bot token for "${id}": `);
    if (!value.trim()) {
      out.fail('nothing entered');
      return 1;
    }
    await setCredential(`channel:${id}`, value.trim());
    out.ok(`stored — ${credentialHint(value.trim())} · credentials.json, mode 0600, never in config`);
    return 0;
  } finally {
    prompter.close();
  }
}

async function serve(flags: Flags): Promise<number> {
  const config = await loadConfig();
  const workspace = typeof flags['workspace'] === 'string' ? flags['workspace'] : process.cwd();
  const manager = new ChannelManager(config, workspace);

  let started: string[];
  try {
    started = await manager.start();
  } catch (e) {
    out.fail(toHatsError(e).message);
    return 1;
  }
  if (started.length === 0) {
    out.fail('no channel could start');
    out.dim('  hats channel list  shows why');
    return 1;
  }

  out.ok(`listening on ${started.join(', ')} · ctrl-c to stop`);
  for (const c of manager.list()) {
    out.keyValue(c.id, `${c.kind} · ${c.allowFrom} allowed sender(s) · ${c.profile}`);
  }

  const controller = new AbortController();
  let running = true;
  const stop = () => {
    running = false;
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    let handled: Awaited<ReturnType<typeof manager.tick>> = [];
    try {
      handled = await manager.tick(controller.signal);
    } catch (e) {
      if (!running) break;
      out.warn(toHatsError(e).message);
    }
    for (const h of handled) {
      const when = new Date().toLocaleTimeString();
      if (!h.authorised) {
        out.warn(`${when}  ${h.channel}  ignored a message from ${h.from} (not on the allowlist)`);
      } else if (h.error) {
        out.fail(`${when}  ${h.channel}  ${h.from}: ${h.error}`);
      } else {
        out.ok(`${when}  ${h.channel}  ${h.from}: ${h.answer.split('\n')[0]?.slice(0, 80) ?? ''}`);
      }
    }
    // Telegram long-polls inside poll(); the local transport returns at once, so this
    // keeps a file-backed channel from spinning the CPU.
    if (running) await sleep(2_000, controller.signal);
  }
  out.line();
  out.dim('stopped');
  return 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
