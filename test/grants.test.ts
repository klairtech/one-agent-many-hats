/**
 * ADR-0009. A grant is the only thing standing between "unattended and read-only" and
 * "unattended and able to change your machine", so the tests here are all about the ways
 * a scope could fail open.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkGrants,
  consumeGrant,
  createGrant,
  globMatches,
  grantStatus,
  isWideOpen,
  listGrants,
  revokeGrant,
} from '../src/schedule/grants.js';
import { type UnattendedDecision } from '../src/schedule/unattended.js';
import { unattendedApprover } from '../src/schedule/unattended.js';
import { isHatsError } from '../src/core/errors.js';
import { cleanup, tempHome } from './helpers.js';

const WS = '/tmp/ws';

test('a grant without a scope is refused outright', async () => {
  const home = await tempHome();
  try {
    for (const tools of [['write_file'], ['run_command'], ['send_email'], ['ssh_run']]) {
      await assert.rejects(
        () => createGrant({ tools, reason: 'because' }),
        (e: unknown) => isHatsError(e) && /requires a .* scope/.test((e as Error).message),
        `${tools[0]} was granted with no scope`,
      );
    }
    // A tool with no scope definition cannot be granted at all.
    await assert.rejects(
      () => createGrant({ tools: ['sandbox_run'], scope: { paths: ['*'] }, reason: 'x' }),
      (e: unknown) => isHatsError(e) && /cannot be granted/.test((e as Error).message),
    );
    // And a grant with no stated reason, because an unreviewable permission is the problem.
    await assert.rejects(
      () => createGrant({ tools: ['write_file'], scope: { paths: ['a/**'] }, reason: '  ' }),
      (e: unknown) => isHatsError(e),
    );
    assert.equal((await listGrants()).length, 0);
  } finally {
    await cleanup(home);
  }
});

test('a path scope confines the call to it', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['write_file'],
      scope: { paths: ['reports/**'] },
      reason: 'nightly summary',
    });

    const inside = await checkGrants('write_file', { path: 'reports/2026/aug.md' }, WS);
    assert.equal(inside.allowed, true, inside.reason);

    for (const outside of ['src/index.ts', 'reports.txt', '../reports/x.md', '/etc/passwd']) {
      const r = await checkGrants('write_file', { path: outside }, WS);
      assert.equal(r.allowed, false, `escaped the scope: ${outside}`);
    }
    // A different tool is not covered by this grant at all.
    const other = await checkGrants('run_command', { command: 'ls' }, WS);
    assert.equal(other.allowed, false);
  } finally {
    await cleanup(home);
  }
});

test('a command scope does not authorise a different command', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['run_command'],
      scope: { commands: ['systemctl restart worker*', 'npm test'] },
      reason: 'restart the worker overnight',
    });
    assert.equal((await checkGrants('run_command', { command: 'systemctl restart worker-2' }, WS)).allowed, true);
    assert.equal((await checkGrants('run_command', { command: 'npm test' }, WS)).allowed, true);
    for (const bad of ['rm -rf /', 'systemctl stop worker', 'npm test && rm -rf /', 'sudo systemctl restart worker']) {
      assert.equal(
        (await checkGrants('run_command', { command: bad }, WS)).allowed,
        false,
        `allowed: ${bad}`,
      );
    }
  } finally {
    await cleanup(home);
  }
});

test('a recipient scope is exact — the agent cannot invent an address', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['send_email'],
      scope: { recipients: ['me@example.com'] },
      reason: 'alerts to myself',
    });
    assert.equal((await checkGrants('send_email', { to: 'me@example.com' }, WS)).allowed, true);
    assert.equal((await checkGrants('send_email', { to: 'ME@EXAMPLE.COM' }, WS)).allowed, true);
    // One allowed recipient does not carry an unlisted one along with it.
    assert.equal(
      (await checkGrants('send_email', { to: 'me@example.com, dealer@cars.example' }, WS)).allowed,
      false,
    );
    assert.equal((await checkGrants('send_email', { to: 'someone@else.example' }, WS)).allowed, false);
  } finally {
    await cleanup(home);
  }
});

test('a host scope covers subdomains only when asked to', async () => {
  const home = await tempHome();
  try {
    await createGrant({ tools: ['ssh_run'], scope: { hosts: ['web1'] }, reason: 'queue check' });
    await createGrant({ tools: ['fetch_url'], scope: { hosts: ['.example.com'] }, reason: 'docs' });

    assert.equal((await checkGrants('ssh_run', { host: 'web1' }, WS)).allowed, true);
    assert.equal((await checkGrants('ssh_run', { host: 'web2' }, WS)).allowed, false);
    assert.equal((await checkGrants('fetch_url', { url: 'https://docs.example.com/a' }, WS)).allowed, true);
    assert.equal((await checkGrants('fetch_url', { url: 'https://evil.com/?x=example.com' }, WS)).allowed, false);
  } finally {
    await cleanup(home);
  }
});

test('expiry, use budget and revocation all stop a grant working', async () => {
  const home = await tempHome();
  try {
    const expired = await createGrant({
      tools: ['write_file'],
      scope: { paths: ['a/**'] },
      reason: 'x',
      expiresAt: '2020-01-01T00:00:00Z',
    });
    assert.equal(grantStatus(expired), 'expired');
    assert.equal((await checkGrants('write_file', { path: 'a/b.txt' }, WS)).allowed, false);

    const budgeted = await createGrant({
      tools: ['apply_patch'],
      scope: { paths: ['b/**'] },
      reason: 'y',
      maxUses: 2,
    });
    for (let i = 0; i < 2; i++) {
      const r = await checkGrants('apply_patch', { path: 'b/c.ts' }, WS);
      assert.equal(r.allowed, true, `use ${i + 1} was refused`);
      await consumeGrant(r.grant!);
    }
    // The budget is persisted, so it holds across runs and restarts.
    const spent = await checkGrants('apply_patch', { path: 'b/c.ts' }, WS);
    assert.equal(spent.allowed, false, 'the use budget did not hold');
    assert.match(spent.reason, /spent/);

    await revokeGrant(budgeted.id);
    assert.equal(grantStatus((await listGrants()).find((g) => g.id === budgeted.id)!), 'revoked');
  } finally {
    await cleanup(home);
  }
});

test('a grant confined to one workspace does not work in another', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['write_file'],
      scope: { paths: ['**'] },
      reason: 'this project only',
      workspace: '/tmp/project-a',
    });
    assert.equal((await checkGrants('write_file', { path: 'x.txt' }, '/tmp/project-a')).allowed, true);
    assert.equal((await checkGrants('write_file', { path: 'x.txt' }, '/tmp/project-b')).allowed, false);
  } finally {
    await cleanup(home);
  }
});

/** The whole point: an unattended run acts under a grant and only within it. */
test('the unattended approver honours a grant and still denies everything else', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['write_file'],
      scope: { paths: ['reports/**'] },
      reason: 'nightly summary',
    });
    const decisions: UnattendedDecision[] = [];
    const approve = unattendedApprover(
      {
        profile: 'assisted',
        allowTools: [],
        trigger: { kind: 'schedule', id: 'sch_1', actor: 'sandeep' },
        workspace: WS,
      },
      decisions,
    );

    assert.equal(
      await approve({ tool: 'write_file', headline: '', detail: '', args: { path: 'reports/a.md' } }),
      true,
    );
    assert.equal(
      await approve({ tool: 'write_file', headline: '', detail: '', args: { path: 'src/a.ts' } }),
      false,
      'a path outside the scope was allowed',
    );
    assert.equal(
      await approve({ tool: 'run_command', headline: '', detail: '', args: { command: 'ls' } }),
      false,
    );
    assert.equal(decisions[0]?.via, 'grant');
    assert.match(decisions[0]?.reason ?? '', /nightly summary/);
    assert.equal(decisions[1]?.via, undefined);
  } finally {
    await cleanup(home);
  }
});

test('the remote approver is consulted only when nothing else allows the call', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['write_file'],
      scope: { paths: ['ok/**'] },
      reason: 'covered',
    });
    const asked: string[] = [];
    const decisions: UnattendedDecision[] = [];
    const approve = unattendedApprover(
      {
        profile: 'assisted',
        allowTools: [],
        trigger: { kind: 'message', id: 'tg:1', actor: 'sandeep' },
        workspace: WS,
        askHuman: async (req) => {
          asked.push(req.tool);
          return { approved: true, by: 'sandeep', reason: 'said yes' };
        },
      },
      decisions,
    );

    // Covered by the grant: the human is not disturbed.
    await approve({ tool: 'write_file', headline: '', detail: '', args: { path: 'ok/a.md' } });
    assert.deepEqual(asked, [], 'asked a human about something a grant already allowed');

    // Not covered: they get asked, and their yes is recorded as theirs.
    assert.equal(
      await approve({ tool: 'run_command', headline: '', detail: '', args: { command: 'ls' } }),
      true,
    );
    assert.deepEqual(asked, ['run_command']);
    assert.equal(decisions[1]?.via, 'asked');
    assert.match(decisions[1]?.reason ?? '', /approved by sandeep/);
  } finally {
    await cleanup(home);
  }
});

test('glob matching is anchored at both ends', () => {
  assert.equal(globMatches('reports/a.md', 'reports/**'), true);
  assert.equal(globMatches('reports/2026/a.md', 'reports/**'), true);
  assert.equal(globMatches('src/reports/a.md', 'reports/**'), false);
  assert.equal(globMatches('reports/a.md.bak', 'reports/*.md'), false);
  assert.equal(globMatches('a/b/c', 'a/*/c'), true);
  assert.equal(globMatches('a/b/x/c', 'a/*/c'), false);
  assert.equal(isWideOpen({ paths: ['**'] }), true);
  assert.equal(isWideOpen({ paths: ['reports/**'] }), false);
});

/**
 * A click is a mutation on whatever page happens to be open, and the arguments never say
 * which site. Handler-supplied facts are what make browser_act grantable at all — without
 * them an unattended run could not click anything, on any site, ever.
 */
test('a browser grant is confined to the site that is actually open', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['browser_act'],
      scope: { hosts: ['status.example.com'] },
      reason: 'dismiss the banner on our status page each morning',
    });

    const onSite = await checkGrants('browser_act', { action: 'click', target: 'OK', host: 'status.example.com' }, WS);
    assert.equal(onSite.allowed, true, onSite.reason);

    // The same click on a different site is not covered.
    const elsewhere = await checkGrants('browser_act', { action: 'click', target: 'OK', host: 'bank.example.com' }, WS);
    assert.equal(elsewhere.allowed, false);

    // And with no page open there is no host, so nothing matches.
    assert.equal((await checkGrants('browser_act', { action: 'click', target: 'OK' }, WS)).allowed, false);
  } finally {
    await cleanup(home);
  }
});

/** The model's own arguments must win, so a handler cannot redirect the scope check. */
test('handler facts cannot override what the call actually asked for', async () => {
  const home = await tempHome();
  try {
    await createGrant({
      tools: ['ssh_run'],
      scope: { hosts: ['web1'] },
      reason: 'queue check',
    });
    const { unattendedApprover } = await import('../src/schedule/unattended.js');
    const decisions: UnattendedDecision[] = [];
    const approve = unattendedApprover(
      {
        profile: 'assisted',
        allowTools: [],
        trigger: { kind: 'schedule', id: 's', actor: 'a' },
        workspace: WS,
      },
      decisions,
    );
    // A handler claiming "web1" must not launder a call aimed at prod-db.
    const allowed = await approve({
      tool: 'ssh_run',
      headline: '',
      detail: '',
      args: { host: 'prod-db', command: 'ls' },
      scope: { host: 'web1' },
    });
    assert.equal(allowed, false, 'handler facts overrode the real target');
  } finally {
    await cleanup(home);
  }
});
