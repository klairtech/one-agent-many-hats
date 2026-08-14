/**
 * `hats grant` — the human side of ADR-0009.
 *
 * This is the only place a grant can be created from the CLI, and `createGrant` refuses
 * anything unscoped, so the command cannot be used to hand over a tool wholesale by
 * accident. A wildcard scope is warned about and allowed: refusing to let someone say what
 * they mean is how you get them turning the profile up instead.
 */

import type { Profile } from '../core/config.js';
import { out, paint } from './render.js';
import {
  createGrant,
  deleteGrant,
  grantStatus,
  listGrants,
  revokeGrant,
  isWideOpen,
  type Grant,
} from '../schedule/grants.js';

type Flags = Record<string, string | boolean>;

export async function grantCommand(positional: string[], flags: Flags): Promise<number> {
  const sub = positional[0] ?? 'list';
  switch (sub) {
    case 'add':
      return add(flags);
    case 'list':
    case 'ls':
      return list();
    case 'revoke':
      return revoke(positional[1]);
    case 'rm':
    case 'delete':
      return remove(positional[1]);
    default:
      out.fail(`unknown: hats grant ${sub}`);
      usage();
      return 1;
  }
}

function usage(): void {
  out.line(`
  hats grant add --tool write_file --paths "reports/**" --reason "nightly summary"
  hats grant add --tool run_command --commands "systemctl restart worker*" \\
                 --reason "restart the worker overnight" --max-uses 20 --expires 2026-09-01
  hats grant add --tool send_email --recipients "me@example.com" --reason "alerts"
  hats grant add --tool ssh_run --hosts "web1" --reason "check the queue"
  hats grant list
  hats grant revoke <id>       stop it working, keep the record
  hats grant rm <id>           delete it entirely

  ${paint('A grant lets an unattended run act without asking. Every grant needs a scope —', 'grey')}
  ${paint('there is no way to grant a tool wholesale, because that is what this replaces.', 'grey')}
  ${paint('Unscoped calls are still denied, and still reported in the run.', 'grey')}
`);
}

async function add(flags: Flags): Promise<number> {
  const tools = listFlag(flags['tool']);
  if (tools.length === 0) {
    out.fail('usage: hats grant add --tool <name> --<scope> <patterns> --reason "why"');
    usage();
    return 1;
  }

  const scope = {
    ...(listFlag(flags['paths']).length ? { paths: listFlag(flags['paths']) } : {}),
    ...(listFlag(flags['hosts']).length ? { hosts: listFlag(flags['hosts']) } : {}),
    ...(listFlag(flags['commands']).length ? { commands: listFlag(flags['commands']) } : {}),
    ...(listFlag(flags['recipients']).length ? { recipients: listFlag(flags['recipients']) } : {}),
  };

  const grant = await createGrant({
    tools,
    scope,
    reason: typeof flags['reason'] === 'string' ? flags['reason'] : '',
    ...(typeof flags['expires'] === 'string' ? { expiresAt: flags['expires'] } : {}),
    ...(flags['max-uses'] ? { maxUses: Number(flags['max-uses']) } : {}),
    ...(typeof flags['workspace'] === 'string'
      ? { workspace: flags['workspace'] }
      : { workspace: process.cwd() }),
  });

  out.ok(`granted ${paint(grant.id, 'bold')}`);
  out.keyValue('tools', grant.tools.join(', '));
  for (const [k, v] of Object.entries(grant.scope)) out.keyValue(k, (v as string[]).join(', '));
  out.keyValue('reason', grant.reason);
  out.keyValue('workspace', grant.workspace ?? 'any');
  if (grant.maxUses) out.keyValue('uses', `${grant.maxUses} before it stops`);
  if (grant.expiresAt) out.keyValue('expires', new Date(grant.expiresAt).toLocaleString());
  if (!grant.maxUses && !grant.expiresAt) {
    out.warn('This grant has no expiry and no use limit. It works until you revoke it.');
  }
  if (isWideOpen(grant.scope)) {
    out.warn(
      'The scope contains a wildcard, so this authorises essentially everything that tool can do. ' +
        'That is allowed, but it is the blunt version — narrow it if you can.',
    );
  }
  return 0;
}

async function list(): Promise<number> {
  const all = await listGrants();
  if (all.length === 0) {
    out.dim('no grants — unattended runs can read and report, and change nothing');
    out.dim('  hats grant add --tool write_file --paths "reports/**" --reason "nightly summary"');
    return 0;
  }
  out.table(
    all.map((g) => [
      paint(g.id, 'grey'),
      statusCell(g),
      g.tools.join(','),
      Object.entries(g.scope).map(([k, v]) => `${k}=${(v as string[]).join('|')}`).join(' '),
      g.maxUses ? `${g.used}/${g.maxUses}` : String(g.used),
      g.expiresAt ? new Date(g.expiresAt).toLocaleDateString() : '—',
      g.reason.slice(0, 40),
    ]),
    ['id', 'state', 'tools', 'scope', 'used', 'expires', 'reason'],
  );
  return 0;
}

function statusCell(g: Grant): string {
  const s = grantStatus(g);
  const tone = s === 'active' ? 'green' : s === 'revoked' ? 'red' : 'yellow';
  return paint(s, tone as 'green');
}

async function revoke(id: string | undefined): Promise<number> {
  if (!id) {
    out.fail('usage: hats grant revoke <id>');
    return 1;
  }
  const g = await revokeGrant(id);
  out.ok(`revoked ${g.id} — ${g.reason}`);
  out.dim('  the record is kept: what was permitted, and when it stopped');
  return 0;
}

async function remove(id: string | undefined): Promise<number> {
  if (!id) {
    out.fail('usage: hats grant rm <id>');
    return 1;
  }
  const g = await deleteGrant(id);
  out.ok(`deleted ${g.id} — ${g.reason}`);
  return 0;
}

function listFlag(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export type { Profile };
