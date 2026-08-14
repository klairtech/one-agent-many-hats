import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { chunkDocument, citation, DocumentIndex } from '../src/rag/index.js';
import { MockProvider } from '../src/providers/index.js';
import { cleanup, tempHome, tempWorkspace, testConfig } from './helpers.js';

const DOC = `# Install

Run the installer. It needs Node.

## macOS

Use Homebrew. The binary lands in /opt/homebrew/bin.

## Linux

Use the tarball.

# Configuration

Settings live in config.json. The timeout defaults to thirty seconds.
`;

test('chunks split on headings and carry the heading trail', () => {
  const chunks = chunkDocument('guide.md', DOC, { maxChars: 400, overlapChars: 0 });
  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);

  const mac = chunks.find((c) => c.text.includes('Homebrew'));
  assert.ok(mac, 'the macOS passage should be its own chunk');
  assert.deepEqual(mac?.headings, ['Install', 'macOS']);
  assert.match(citation(mac!), /guide\.md:\d+-\d+ — Install > macOS/);

  const config = chunks.find((c) => c.text.includes('config.json'));
  assert.deepEqual(config?.headings, ['Configuration']);
});

test('an oversized block is split with overlap rather than truncated', () => {
  const long = 'Sentence number one. '.repeat(400);
  const chunks = chunkDocument('big.txt', long, { maxChars: 500, overlapChars: 100 });
  assert.ok(chunks.length > 5);
  const joined = chunks.map((c) => c.text).join(' ');
  assert.ok(joined.length >= long.trim().length, 'no content may be dropped');
});

test('line numbers point back at the source', () => {
  const chunks = chunkDocument('guide.md', DOC, { maxChars: 400, overlapChars: 0 });
  const lines = DOC.split('\n');
  for (const chunk of chunks) {
    assert.ok(chunk.startLine >= 1 && chunk.endLine <= lines.length + 1, `bad range on ${chunk.id}`);
  }
});

test('indexes a workspace and finds a passage by keyword, with a citation', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({ 'docs/guide.md': DOC, 'src/app.ts': 'export const port = 8080;' });
  const index = new DocumentIndex(path.join(home, 'index'));

  const meta = await index.build({ root: ws, config: testConfig() });
  assert.equal(meta.files, 2);
  assert.ok(meta.chunks >= 3);
  assert.equal(meta.embedModel, null, 'no embedder was supplied, so it must be keyword-only');

  const result = await index.search('homebrew', 5);
  assert.equal(result.mode, 'keyword');
  assert.ok(result.hits.length > 0);
  assert.match(result.hits[0]?.citation ?? '', /guide\.md/);
  assert.match(result.hits[0]?.chunk.text ?? '', /Homebrew/);
  await cleanup(home, ws);
});

test('keyword-only results carry the caveat rather than implying understanding', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({ 'docs/guide.md': DOC });
  const index = new DocumentIndex(path.join(home, 'index'));
  await index.build({ root: ws, config: testConfig() });

  const result = await index.search('install', 3);
  assert.ok(result.caveat, 'keyword mode must say so');
  assert.match(result.caveat ?? '', /keyword/i);
  await cleanup(home, ws);
});

test('with an embedder it goes hybrid, and results say which ranker found them', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({ 'docs/guide.md': DOC });
  const index = new DocumentIndex(path.join(home, 'index'));
  const embedder = new MockProvider('mock', []);

  const meta = await index.build({ root: ws, config: testConfig(), embedder, embedModel: 'mock-embed' });
  assert.equal(meta.embedModel, 'mock-embed');
  assert.ok((meta.dimensions ?? 0) > 0);

  const result = await index.search('homebrew', 5, embedder);
  assert.equal(result.mode, 'hybrid');
  assert.equal(result.caveat, null);
  assert.ok(result.hits.every((h) => ['both', 'keyword', 'semantic'].includes(h.matched)));
  assert.ok(
    result.hits.some((h) => h.matched === 'both' || h.matched === 'semantic'),
    'the semantic ranker should contribute something',
  );
  await cleanup(home, ws);
});

test('a rebuild reuses unchanged files and re-chunks only what moved', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({ 'a.md': '# A\n\nalpha content here', 'b.md': '# B\n\nbeta content here' });
  const index = new DocumentIndex(path.join(home, 'index'));

  const first = await index.build({ root: ws, config: testConfig() });
  assert.equal(first.files, 2);

  await fsp.writeFile(path.join(ws, 'b.md'), '# B\n\nbeta content rewritten entirely', 'utf8');

  const messages: string[] = [];
  const second = await index.build({
    root: ws,
    config: testConfig(),
    onProgress: (m) => messages.push(m),
  });
  assert.equal(second.files, 2);
  assert.ok(
    messages.some((m) => /1 files unchanged/.test(m)),
    `expected one file to be reused: ${messages.join(' | ')}`,
  );

  const hit = await index.search('rewritten', 3);
  assert.ok(hit.hits.length > 0, 'the changed file must be searchable in its new form');
  await cleanup(home, ws);
});

test('turning embeddings on re-embeds the whole index, not just what changed', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({ 'a.md': '# A\n\nalpha content', 'b.md': '# B\n\nbeta content' });
  const index = new DocumentIndex(path.join(home, 'index'));

  // First pass: no embedder at all.
  const keywordOnly = await index.build({ root: ws, config: testConfig() });
  assert.equal(keywordOnly.embedModel, null);

  // Second pass: same files, but now an embedder exists. Reusing the unembedded chunks
  // would leave semantic search covering nothing.
  const embedder = new MockProvider('mock', []);
  const hybrid = await index.build({
    root: ws,
    config: testConfig(),
    embedder,
    embedModel: 'mock-embed',
  });
  assert.equal(hybrid.embedModel, 'mock-embed');

  const result = await index.search('alpha', 5, embedder);
  assert.equal(result.mode, 'hybrid');
  assert.ok(
    result.hits.some((h) => h.matched === 'semantic' || h.matched === 'both'),
    'every passage should have been embedded, not just changed ones',
  );
  await cleanup(home, ws);
});

test('searching an unindexed workspace reports nothing rather than failing', async () => {
  const home = await tempHome();
  const index = new DocumentIndex(path.join(home, 'index'));
  const result = await index.search('anything', 5);
  assert.equal(result.indexedChunks, 0);
  assert.equal(result.hits.length, 0);
  await cleanup(home);
});

test('generated and vendored directories are not indexed', async () => {
  const home = await tempHome();
  const ws = await tempWorkspace({
    'src/real.ts': 'export const real = true;',
    'node_modules/pkg/index.js': 'module.exports = 1;',
    'dist/bundle.js': 'var x=1;',
  });
  const index = new DocumentIndex(path.join(home, 'index'));
  const meta = await index.build({ root: ws, config: testConfig() });
  assert.equal(meta.files, 1, 'only the real source file should be indexed');
  await cleanup(home, ws);
});
