/**
 * Redaction and the audit chain.
 *
 * Both of these are controls that are worth nothing if they quietly stop working, and both
 * fail silently by nature: a key that is not matched still gets written, and a chain that
 * is not verified still looks like a log. `redactArgs` in the executor was called redaction
 * for months while eliding nothing sensitive — the name asserted a control that did not
 * exist, which is the specific failure these tests exist to prevent recurring.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { auditLogPath, audit, resetAuditChainCache, verifyAuditChain } from '../src/core/audit.js';
import { redact, redactFields, redactSecrets, redactString } from '../src/core/redact.js';
import { cleanup, tempHome } from './helpers.js';

test('a credential in a log line does not reach the sink', () => {
  const cases: Array<[string, string]> = [
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'anthropic'],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz0123', 'openai'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws'],
    ['xoxb-1234567890-abcdefghijkl', 'slack'],
    ['Bearer abcdefghijklmnopqrstuvwxyz012345', 'bearer'],
  ];
  for (const [secret, kind] of cases) {
    const line = redactString(`calling the provider with ${secret} now`);
    assert.ok(!line.includes(secret), `${kind} key survived redaction: ${line}`);
    assert.match(line, /\[redacted:/);
  }
});

test('redaction leaves ordinary text alone', () => {
  // A filter that mangles normal logs is a filter people switch off, and then it protects
  // nothing at all.
  for (const ordinary of [
    'read 16 files under packs/rules',
    'the answer is 1,284 rows',
    'PASS: 5/5 specifics reconciled against 8 artifacts',
    'art_d8d2108f11a0484c',
  ]) {
    assert.equal(redactString(ordinary), ordinary, `mangled an ordinary line: ${ordinary}`);
  }
});

test('a secret nested inside a structure is found', () => {
  const record = redact({
    tool: 'send_email',
    args: { to: 'someone@example.com', headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz012345' } },
    note: 'key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
  }) as Record<string, unknown>;

  const flat = JSON.stringify(record);
  assert.ok(!flat.includes('sk-ant-api03'), `a nested key reached the sink: ${flat}`);
  assert.ok(!flat.includes('abcdefghijklmnopqrstuvwxyz012345'), 'the bearer token survived');
  // An address is tagged rather than deleted, so records still join on the same person.
  assert.ok(!flat.includes('someone@example.com'), 'the address was written verbatim');
  assert.match(flat, /\[email:/);
});

test('a field whose name says it is sensitive is redacted whatever it holds', () => {
  // The value patterns cannot know every vendor's key shape, so the field name is the
  // second net: `api_key: "hunter2"` matches nothing and is still a secret.
  const fields = redactFields({ api_key: 'hunter2', password: 'correct horse', path: 'src/index.ts' });
  assert.notEqual(fields['api_key'], 'hunter2');
  assert.notEqual(fields['password'], 'correct horse');
  assert.equal(fields['path'], 'src/index.ts', 'an ordinary field was redacted');
});

test('a credential in a URL query string is removed', () => {
  const line = redactSecrets('GET https://api.example.com/v1/models?api_key=abcd1234efgh5678&limit=10');
  assert.ok(!line.includes('abcd1234efgh5678'), line);
  assert.match(line, /limit=10/, 'the harmless parameter should survive');
});

test('an audit record edited after the fact breaks the chain', async () => {
  const home = await tempHome();
  try {
    resetAuditChainCache();
    for (const n of [1, 2, 3]) {
      await audit({
        action: 'data.written',
        actor: 'agent',
        source: 'cli',
        subject: 'ws',
        outcome: 'allowed',
        detail: { n },
      });
    }

    const clean = await verifyAuditChain();
    assert.equal(clean.intact, true, `a chain nobody touched failed to verify: ${JSON.stringify(clean)}`);
    assert.equal(clean.records, 3);

    // Rewrite the middle record, exactly as someone covering their tracks would.
    const file = auditLogPath();
    const lines = (await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[1] as string) as Record<string, unknown>;
    tampered['outcome'] = 'denied';
    lines[1] = JSON.stringify(tampered);
    await fsp.writeFile(file, `${lines.join('\n')}\n`);

    resetAuditChainCache();
    const after = await verifyAuditChain();
    assert.equal(after.intact, false, 'an edited record verified as intact');
    assert.equal(after.brokenAt, 1, 'the wrong record was named as the break');
  } finally {
    resetAuditChainCache();
    await cleanup(home);
  }
});

test('a record removed from the middle breaks the chain too', async () => {
  const home = await tempHome();
  try {
    resetAuditChainCache();
    for (let i = 0; i < 3; i++) {
      await audit({
        action: 'data.written',
        actor: 'agent',
        source: 'cli',
        subject: 'ws',
        outcome: 'allowed',
        detail: { i },
      });
    }
    const file = auditLogPath();
    const lines = (await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean);
    // Deletion is the other half of tampering, and a chain that only catches edits would
    // let anyone drop the record they minded.
    await fsp.writeFile(file, `${[lines[0], lines[2]].join('\n')}\n`);

    resetAuditChainCache();
    assert.equal((await verifyAuditChain()).intact, false, 'a deleted record went unnoticed');
  } finally {
    resetAuditChainCache();
    await cleanup(home);
  }
});
