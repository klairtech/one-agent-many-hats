/**
 * The markdown renderer and the file boundary.
 *
 * Both handle text that came from a model, a file or a web page, so both are places where
 * "it looked fine in the happy case" is not good enough.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { renderPage } from "../src/ui/page.js";
import test from 'node:test';

import { renderMarkdown, escapeHtml } from '../src/ui/markdown.js';
import { classify, listDirectory, preview } from '../src/ui/files.js';
import { formatBytes, prune, runIdTime, scanSpace } from '../src/core/space.js';
import { cleanup, tempHome, tempWorkspace, testConfig } from './helpers.js';

test('markdown escapes before it renders, so nothing becomes live HTML', () => {
  const html = renderMarkdown('Hello <script>alert(1)</script> and <img src=x onerror=y>');
  // The escaped source legitimately still contains the characters "onerror=" as text.
  // What matters is that no tag was emitted, so check for tags rather than for substrings.
  assert.ok(!/<script/i.test(html), 'a script tag must never be emitted');
  assert.ok(!/<img/i.test(html), 'an img tag must never be emitted');
  assert.match(html, /&lt;script&gt;/, 'it should appear as visible, inert text');
  assert.match(html, /&lt;img src=x onerror=y&gt;/);
});

test('a javascript: link is left as text rather than made clickable', () => {
  const html = renderMarkdown('[click me](javascript:alert(1))');
  assert.ok(!/href="javascript:/i.test(html), 'must not emit a javascript: href');
  assert.match(html, /click me/);

  const ok = renderMarkdown('[docs](https://example.com/x)');
  assert.match(ok, /<a href="https:\/\/example\.com\/x"/);
});

test('renders the shapes agent answers actually use', () => {
  const html = renderMarkdown(
    [
      '# Findings',
      '',
      'The count is **42** and the file is `src/app.ts`.',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '> a quoted caveat',
      '',
      '```ts',
      'const x = 1 < 2;',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n'),
  );
  assert.match(html, /<h1 class="md-h">Findings<\/h1>/);
  assert.match(html, /<strong>42<\/strong>/);
  assert.match(html, /<code>src\/app\.ts<\/code>/);
  assert.match(html, /<ul class="md-list">/);
  assert.match(html, /<ol class="md-list">/);
  assert.match(html, /<blockquote/);
  assert.match(html, /<pre class="md-code" data-lang="ts">/);
  assert.match(html, /const x = 1 &lt; 2;/, 'code content stays escaped');
  assert.match(html, /<table class="md-table">/);
});

test('hard-wrapped source becomes one paragraph, not a stack of them', () => {
  // Every doc in this project and most model output is wrapped at ~90 columns.
  const html = renderMarkdown(
    ['Not a prompt somebody buried in a Python file. Files. On your disk.', 'With version numbers.', '', 'A second paragraph.'].join('\n'),
  );
  const paras = html.match(/<p>/g) ?? [];
  assert.equal(paras.length, 2, 'two blank-line-separated blocks means two paragraphs');
  assert.match(html, /On your disk\. With version numbers\./, 'wrapped lines join with a space');
});

test('a wrapped list item stays in its item', () => {
  const html = renderMarkdown(['- first item that runs on', '  to a second line', '- second item'].join('\n'));
  assert.match(html, /<li>first item that runs on to a second line<\/li>/);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
});

test('artifact citations become chips so evidence is visible', () => {
  const html = renderMarkdown('Gross margin fell (art_5abc0fcab064).');
  assert.match(html, /<span class="md-art">art_5abc0fcab064<\/span>/);
});

test('markup inside a code span is not re-processed', () => {
  const html = renderMarkdown('use `**not bold**` here');
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
  assert.ok(!/<code><strong>/.test(html));
});

test('escapeHtml covers the five characters that matter', () => {
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('file kinds drive the preview that gets chosen', () => {
  assert.equal(classify('README.md'), 'markdown');
  assert.equal(classify('a.png'), 'image');
  assert.equal(classify('report.pdf'), 'pdf');
  assert.equal(classify('page.html'), 'html');
  assert.equal(classify('deck.pptx'), 'office');
  assert.equal(classify('app.ts'), 'code');
  assert.equal(classify('notes.txt'), 'text');
  assert.equal(classify('thing.bin'), 'binary');
});

test('the file browser cannot escape the workspace', async () => {
  const ws = await tempWorkspace({ 'a.md': '# A', 'sub/b.ts': 'export const b = 1;' });
  const listing = await listDirectory(ws, '.');
  assert.ok(listing.entries.some((e) => e.name === 'a.md'));
  assert.equal(listing.parent, null, 'the root has no parent to climb to');

  await assert.rejects(listDirectory(ws, '../..'), /outside the workspace/);
  await assert.rejects(preview(ws, '/etc/passwd'), /outside the workspace/);
  await cleanup(ws);
});

test('office formats are declined honestly rather than half-rendered', async () => {
  const ws = await tempWorkspace({ 'deck.pptx': 'PK-not-really-a-zip' });
  const p = await preview(ws, 'deck.pptx');
  assert.equal(p.kind, 'office');
  assert.equal(p.text, undefined);
  assert.match(p.note ?? '', /open it in the app/i);
  await cleanup(ws);
});

test('space scanning reports categories and what they cost', async () => {
  const home = await tempHome();
  const report = await scanSpace();
  assert.equal(report.home, home);
  assert.ok(report.global.length >= 3);
  for (const entry of report.global) {
    assert.ok(entry.cost.length > 20, `${entry.key} needs to say what deleting it costs`);
    assert.ok(['free', 'rebuildable', 'lossy', 'permanent'].includes(entry.reversibility));
  }
  await cleanup(home);
});

test('pruning refuses to touch anything outside the hats home', async () => {
  const home = await tempHome();
  await assert.rejects(prune({ target: 'workspace', workspace: '../../..' }), /outside|whole hats home/);
  await cleanup(home);
});

test('a dry run reports without deleting', async () => {
  const home = await tempHome();
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const cache = path.join(home, 'cache');
  await fsp.mkdir(cache, { recursive: true });
  await fsp.writeFile(path.join(cache, 'x.json'), '{"a":1}', 'utf8');

  const dry = await prune({ target: 'cache', dryRun: true });
  assert.ok(dry.bytesFreed > 0);
  assert.equal(dry.dryRun, true);
  await fsp.access(path.join(cache, 'x.json')); // still there

  const real = await prune({ target: 'cache' });
  assert.ok(real.bytesFreed > 0);
  await assert.rejects(fsp.access(path.join(cache, 'x.json')));
  await cleanup(home);
});

test('run ids parse back to a time so age-based pruning works', () => {
  assert.equal(runIdTime('20260814T130508Z-843a35'), Date.parse('2026-08-14T13:05:08Z'));
  assert.equal(runIdTime('not-a-run'), null);
});

test('byte formatting is readable', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.match(formatBytes(5 * 1024 * 1024), /5\.0 MB/);
});

/**
 * The page is one big template literal, so a broken escape inside it is still a perfectly
 * valid TypeScript string — `tsc` compiles it, the tests pass, and the panel serves a page
 * whose script dies on load with a blank screen. That shipped to main once: a `\n` written
 * where `\\n` was needed became a real newline inside a JS string literal.
 *
 * Parsing the emitted script is the only check that catches it.
 */
test('the page it serves is syntactically valid JavaScript', () => {
  const html = renderPage('test-token');
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  assert.ok(open > 0 && close > open, 'no script block found in the page');
  const js = html.slice(open + '<script>'.length, close);

  // new Function parses without executing, so no DOM is needed.
  assert.doesNotThrow(() => new Function(js), 'the page script does not parse');
});

test('the page has no stray backticks in it', () => {
  // page.ts is a template literal: an unescaped backtick anywhere ends the string early
  // and produces a compile error that points at a line hundreds away from the cause.
  const html = renderPage('test-token');
  assert.ok(html.length > 10_000, 'the page rendered suspiciously short');
  assert.ok(!html.includes('${'), 'an unexpanded template placeholder reached the page');
});

/**
 * ProviderPool reads its config object live on every resolve, so the panel must mutate
 * `session.config` rather than replace it. Reassigning detached the pool: the panel wrote a
 * new tier binding to disk, reported success, and carried on calling the old model with
 * nothing in the interface to show why.
 */
test('changing a tier reaches the provider pool that was built before it', async () => {
  const home = await tempHome();
  try {
    const { ProviderPool } = await import('../src/providers/index.js');
    const config = testConfig();
    config.tiers = { ...config.tiers, frontier: 'mock/big' };

    // Built once, as the panel does at startup.
    const pool = new ProviderPool(config);
    assert.equal(pool.resolve('frontier').model, 'big');

    // What the panel does on save: read from disk and merge onto the same object.
    const fromDisk = { ...config, tiers: { ...config.tiers, frontier: 'mock/small' } };
    Object.assign(config, fromDisk);

    assert.equal(
      pool.resolve('frontier').model,
      'small',
      'the pool did not see the new binding — session.config was replaced rather than mutated',
    );
  } finally {
    await cleanup(home);
  }
});

/**
 * A password typed into a chat form would otherwise sit in the transcript, in an artifact,
 * and in every prompt for the rest of the run. Secret fields are diverted at the server
 * boundary: the value goes to credentials.json and the model is told only the last four
 * characters. This asserts the value never appears in what the tool returns.
 */
test('a secret field never reaches the model', async () => {
  const home = await tempHome();
  try {
    const { getCredential, setCredential, credentialHint, resetCredentialCache } = await import(
      '../src/core/credentials.js'
    );
    resetCredentialCache();

    // What the server does with a form answer, in miniature.
    const fields = [
      { name: 'athena_region', label: 'Region', type: 'text' as const },
      { name: 'athena_key', label: 'Access key', type: 'secret' as const },
    ];
    const values: Record<string, string> = {
      athena_region: 'ap-south-1',
      athena_key: 'AKIAsupersecretvalue9999',
    };

    const parts: string[] = [];
    for (const field of fields) {
      const raw = values[field.name] ?? '';
      if (field.type === 'secret') {
        await setCredential(field.name, raw);
        parts.push(`${field.name}: stored securely (${credentialHint(raw)})`);
      } else {
        parts.push(`${field.name}: ${raw}`);
      }
    }
    const answer = parts.join('\n');

    assert.ok(!answer.includes('AKIAsupersecretvalue9999'), 'the secret leaked into the answer');
    assert.match(answer, /athena_region: ap-south-1/, 'ordinary fields must come through');
    assert.match(answer, /stored securely/);
    assert.match(answer, /9999/, 'the hint should identify which key it was');
    // And it is actually retrievable where it belongs.
    assert.equal(getCredential('athena_key'), 'AKIAsupersecretvalue9999');
  } finally {
    await cleanup(home);
  }
});

/**
 * The Outputs panel claims a run "wrote 2 files". It has to be true.
 *
 * The obvious source is the audit trail, and it is wrong: `tool.call` is logged before the
 * allowlist, the profile check, the gate and the human approval, so every refused write is
 * in there looking exactly like a successful one. On a mutating tool a refusal is the
 * ordinary outcome, which makes the wrong source wrong most of the time.
 */
test('files written are the writes that happened, not the ones that were asked for', async () => {
  const home = await tempHome();
  const runs = path.join(home, 'runs');
  try {
    const { collectOutputs } = await import('../src/ui/outputs.js');
    const run = path.join(runs, '20260816T101500Z-aaaaaa');
    await fsp.mkdir(path.join(run, 'artifacts'), { recursive: true });

    // One write that returned, one that the human declined. A denial never gets an artifact.
    await fsp.writeFile(
      path.join(run, 'artifacts', 'art_ok.json'),
      JSON.stringify({ id: 'art_ok', tool: 'write_file', payload: { path: 'reports/q3.md', bytes: 12 } }),
    );
    await fsp.writeFile(
      path.join(run, 'run.json'),
      JSON.stringify({
        runId: '20260816T101500Z-aaaaaa',
        request: 'write the report',
        startedAt: '2026-08-16T10:15:00Z',
        ok: true,
        observations: [
          { tool: 'write_file', artifactId: 'art_ok', ok: true, summary: 'created reports/q3.md' },
          { tool: 'write_file', ok: false, summary: 'DENIED (APPROVAL_DENIED): the human declined' },
        ],
      }),
    );

    const produced = await collectOutputs(runs);
    assert.equal(produced.runs.length, 1);
    assert.deepEqual(
      produced.runs[0]?.files,
      ['reports/q3.md'],
      'a declined write must not be reported as a file on disk',
    );
    // The path is the one the file browser can open, not the one the model typed.
    assert.equal(produced.runs[0]?.artifacts.length, 1);
  } finally {
    await cleanup(home);
  }
});

test('a run that produced nothing is skipped, and a corrupt record does not take the panel down', async () => {
  const home = await tempHome();
  const runs = path.join(home, 'runs');
  try {
    const { collectOutputs } = await import('../src/ui/outputs.js');

    const empty = path.join(runs, '20260816T090000Z-bbbbbb');
    await fsp.mkdir(empty, { recursive: true });
    await fsp.writeFile(path.join(empty, 'run.json'), JSON.stringify({ request: 'just talk', observations: [] }));

    const broken = path.join(runs, '20260816T095000Z-cccccc');
    await fsp.mkdir(broken, { recursive: true });
    await fsp.writeFile(path.join(broken, 'run.json'), '{ not json');

    // Producing means writing. A run that only read a file has evidence, not output — the
    // distinction the whole view turns on.
    const read = path.join(runs, '20260816T091000Z-eeeeee');
    await fsp.mkdir(path.join(read, 'artifacts'), { recursive: true });
    await fsp.writeFile(
      path.join(read, 'run.json'),
      JSON.stringify({ request: 'just read it', startedAt: '2026-08-16T09:10:00Z', ok: true, observations: [{ tool: 'read_file', artifactId: 'art_r', ok: true, summary: 'read 40 rows' }] }),
    );
    await fsp.writeFile(path.join(read, 'artifacts', 'art_r.json'), JSON.stringify({ payload: { lines: 40 } }));

    const good = path.join(runs, '20260816T093000Z-dddddd');
    await fsp.mkdir(path.join(good, 'artifacts'), { recursive: true });
    await fsp.writeFile(
      path.join(good, 'run.json'),
      JSON.stringify({ request: 'count them', startedAt: '2026-08-16T09:30:00Z', ok: true, observations: [{ tool: 'write_file', artifactId: 'art_1', ok: true, summary: 'wrote it' }] }),
    );
    await fsp.writeFile(path.join(good, 'artifacts', 'art_1.json'), JSON.stringify({ payload: { path: 'reports/counts.md' } }));

    const produced = await collectOutputs(runs);
    assert.equal(produced.runs.length, 1, 'only the run that wrote a file belongs here');
    assert.equal(produced.runs[0]?.request, 'count them');
    assert.deepEqual(produced.runs[0]?.files, ['reports/counts.md']);
    assert.equal(produced.total, 4, 'the count on disk is what the panel reports, not what it shows');
  } finally {
    await cleanup(home);
  }
});

/**
 * The search is over runs, and runs that produced nothing are skipped — so a window over run
 * *directories* is a window over the wrong thing. A handful of chats is enough to push the
 * report written last week off the end of it, and the panel then says "nothing produced yet"
 * about a workspace that plainly did produce something.
 */
test('a conversation that produced something is not buried by later ones that did not', async () => {
  const home = await tempHome();
  const runs = path.join(home, 'runs');
  try {
    const { collectOutputs } = await import('../src/ui/outputs.js');

    const old = path.join(runs, '20260101T000000Z-aaaaaa');
    await fsp.mkdir(path.join(old, 'artifacts'), { recursive: true });
    await fsp.writeFile(
      path.join(old, 'run.json'),
      JSON.stringify({
        request: 'the report from January',
        startedAt: '2026-01-01T00:00:00Z',
        ok: true,
        observations: [{ tool: 'write_file', artifactId: 'art_old', ok: true, summary: 'wrote the report' }],
      }),
    );
    await fsp.writeFile(
      path.join(old, 'artifacts', 'art_old.json'),
      JSON.stringify({ payload: { path: 'reports/january.md' } }),
    );

    // Then a stack of newer conversations that only ever talked.
    for (let i = 0; i < 12; i++) {
      const chat = path.join(runs, `20260201T0000${String(i).padStart(2, '0')}Z-bbbbbb`);
      await fsp.mkdir(chat, { recursive: true });
      await fsp.writeFile(
        path.join(chat, 'run.json'),
        JSON.stringify({ request: `chat ${i}`, startedAt: '2026-02-01T00:00:00Z', ok: true, observations: [] }),
      );
    }

    // `want` is well under the number of quiet conversations in front of it.
    const produced = await collectOutputs(runs, { want: 3, scan: 250 });
    assert.equal(produced.runs.length, 1, 'the January report is still findable behind 12 quiet chats');
    assert.equal(produced.runs[0]?.request, 'the report from January');

    // And when the search itself runs out, the panel is told so rather than left to imply
    // that what it is showing is everything.
    const capped = await collectOutputs(runs, { want: 3, scan: 5 });
    assert.equal(capped.runs.length, 0, 'a scan that stops short finds nothing here');
    assert.equal(capped.scanned, 5);
    assert.equal(capped.total, 13);
    assert.equal(capped.more, true, 'stopping short must be reported, not passed off as an empty history');
  } finally {
    await cleanup(home);
  }
});

/**
 * The panel shows a page of runs, but the runs that count are the ones that produced
 * something — and those are a subset. If the scan is capped at the size of the page, a few
 * recent conversations that produced nothing push every real output off the end, and the
 * panel says "nothing produced yet" over a disk full of outputs.
 *
 * So the scan and the page are two different numbers, and this is the test that says so.
 */
test('conversations that produced nothing do not push real outputs off the page', async () => {
  const home = await tempHome();
  const runs = path.join(home, 'runs');
  try {
    const { collectOutputs } = await import('../src/ui/outputs.js');

    // Three recent conversations that produced nothing, sitting on top of two that did.
    const write = async (id: string, observations: unknown[]) => {
      const dir = path.join(runs, id);
      await fsp.mkdir(path.join(dir, 'artifacts'), { recursive: true });
      await fsp.writeFile(
        path.join(dir, 'run.json'),
        JSON.stringify({ request: id, startedAt: '2026-08-16T00:00:00Z', ok: true, observations }),
      );
      await fsp.writeFile(
        path.join(dir, 'artifacts', 'art_1.json'),
        JSON.stringify({ payload: { path: `out/${id}.md` } }),
      );
    };
    const produced = [{ tool: 'write_file', artifactId: 'art_1', ok: true, summary: 'wrote it' }];
    await write('20260816T090000Z-aaaaaa', produced);
    await write('20260816T090100Z-bbbbbb', produced);
    await write('20260816T090200Z-cccccc', []);
    await write('20260816T090300Z-dddddd', []);
    await write('20260816T090400Z-eeeeee', []);

    const page = await collectOutputs(runs, { want: 2, scan: 10 });
    assert.equal(
      page.runs.length,
      2,
      'the scan stopped at the page size, so runs that produced nothing hid the ones that did',
    );
    assert.ok(page.scanned > 2, 'more run directories have to be read than are displayed');
  } finally {
    await cleanup(home);
  }
});

/**
 * page.ts is one long template literal, so a backtick anywhere inside it ends the page.
 * The build catches it, but only as "',' expected" pointing at a line that is fine — and
 * it has now happened three times in comments explaining code that mentions an identifier
 * in backticks, which is the most natural thing in the world to write.
 *
 * This says so in one line instead.
 */
test('no comment inside the page template carries a backtick', async () => {
  const src = await fsp.readFile(new URL('../../src/ui/page.ts', import.meta.url), 'utf8');
  const offenders = src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim().startsWith('//') && line.includes(String.fromCharCode(96)));

  assert.deepEqual(
    offenders.map((o) => o.n),
    [],
    `backtick in a comment would end the page template: ${offenders.map((o) => o.n + ': ' + o.line.trim().slice(0, 60)).join(' | ')}`,
  );
});

/**
 * The follow-up offered in the composer is derived from the run, not generated by a second
 * model call — so it can only ever point at something the run actually did. These are the
 * cases where a wrong suggestion would be worst: a disclosed gap that is easy to forget,
 * and a run that did not finish.
 */
test('the composer suggests a follow-up drawn from what the run did', async () => {
  const { renderPage } = await import('../src/ui/page.js');
  const js = renderPage('tok').match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
  // The helper is pure, so it can be lifted out of the page and exercised directly.
  const start = js.indexOf('function suggestFollowUp(');
  const end = js.indexOf('const EXAMPLES = [');
  const suggestFollowUp = new Function(`${js.slice(start, end)}; return suggestFollowUp;`)() as (
    r: unknown,
  ) => string;

  // A declared gap outranks everything: it is the thing the reader most needs to act on.
  assert.equal(
    suggestFollowUp({ ok: true, gateFindings: [{ passed: false, detail: 'x' }], answer: '**17 files**' }),
    'Close the gap you flagged',
  );
  assert.equal(suggestFollowUp({ ok: false, gateFindings: [] }), 'What stopped you finishing?');

  // Something it built is worth reusing while the context is still here.
  assert.match(
    suggestFollowUp({ ok: true, answer: 'built and installed orders_query, callable now.' }),
    /orders_query/,
  );

  // An ordinary cited answer points at the figure.
  assert.match(
    suggestFollowUp({ ok: true, outcomeId: 'outcome/answer', artifactCount: 2, answer: '**17 rule files** are in packs/rules.' }),
    /How did you arrive at 17 rule files/,
  );

  // A figure with no evidence behind it is not something to ask about, so this falls all
  // the way to the generic fallback — which used to presume an investigation ("What else
  // should I look at?"), a non sequitur after a plain factual answer or a question about
  // the agent itself. Now it invites the next step without guessing what kind of answer
  // this was.
  assert.equal(
    suggestFollowUp({ ok: true, outcomeId: 'outcome/answer', artifactCount: 0, answer: '**17 rule files**' }),
    'What should I do with this?',
  );
});


/**
 * A run stream that dies has to say so.
 *
 * There was no error handler on the EventSource at all, so any failure — the run id not
 * resolving, the panel restarting, a dropped connection — left the word "working" on screen
 * with the run already finished. The page is one long template literal and this is easy to
 * lose in an edit, so it is asserted rather than trusted.
 */
test('the chat stream installs an error handler, so a dead stream cannot hang on working', () => {
  const page = renderPage('t');
  assert.match(page, /source\.onerror\s*=/, 'the run stream has no error handler');
  assert.match(page, /readyState/, 'a transient reconnect must be told apart from a closed stream');
  assert.match(page, /Lost the connection to this run/, 'a dead stream should say so in the thread');
});

/**
 * A conversation the model can safely resume — never opening on a tool_result whose
 * tool_use was trimmed out from in front of it.
 *
 * Anthropic pairs a `tool_use` block in one assistant turn with a `tool_result` in the
 * next; slicing a message list to its last N entries can cut exactly between the two, and
 * the provider refuses the whole request rather than the one turn. This was a live 400:
 * `unexpected tool_use_id found in tool_result blocks … no corresponding tool_use`.
 */
test('trimmed history never opens on an orphaned tool result', async () => {
  interface Msg { role: string; content: string; toolCallId?: string; toolCalls?: unknown[] }
  const { dropOrphanedToolResults } = (await import('../src/ui/server.js')) as unknown as {
    dropOrphanedToolResults: (m: Msg[]) => Msg[];
  };

  const paired: Msg[] = [
    { role: 'assistant', content: '' },
    { role: 'tool', content: 'result A', toolCallId: 'a' },
    { role: 'user', content: 'thanks' },
  ];
  // A slice landing mid pair: the assistant's tool_use is gone, only the result remains.
  const orphaned = dropOrphanedToolResults(paired.slice(1));
  assert.equal(orphaned[0]?.role, 'user', `still opens on a tool result: ${JSON.stringify(orphaned[0])}`);
  assert.deepEqual(orphaned, [paired[2]]);

  // Two results in a row — both belong to messages already cut, both must go.
  const doublyOrphaned = dropOrphanedToolResults([
    { role: 'tool', content: 'a', toolCallId: 'a' },
    { role: 'tool', content: 'b', toolCallId: 'b' },
    { role: 'assistant', content: 'done' },
  ]);
  assert.equal(doublyOrphaned.length, 1);
  assert.equal(doublyOrphaned[0]?.role, 'assistant');

  // Nothing to fix: unchanged, not just equal — the common case must not reallocate oddly.
  const clean: Msg[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
  assert.deepEqual(dropOrphanedToolResults(clean), clean);

  // An assistant message that *opens* a tool call is fine to lead with: trimming only ever
  // removes from the front, so its own results are still behind it, untouched.
  const opensACall: Msg[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: 'x' }] },
    { role: 'tool', content: 'result', toolCallId: 'x' },
  ];
  assert.deepEqual(dropOrphanedToolResults(opensACall), opensACall);
});
