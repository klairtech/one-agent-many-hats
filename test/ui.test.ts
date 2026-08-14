/**
 * The markdown renderer and the file boundary.
 *
 * Both handle text that came from a model, a file or a web page, so both are places where
 * "it looked fine in the happy case" is not good enough.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMarkdown, escapeHtml } from '../src/ui/markdown.js';
import { classify, listDirectory, preview } from '../src/ui/files.js';
import { formatBytes, prune, runIdTime, scanSpace } from '../src/core/space.js';
import { cleanup, tempHome, tempWorkspace } from './helpers.js';

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
