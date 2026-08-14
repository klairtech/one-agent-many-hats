import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDocument, parseFrontmatter } from '../src/registry/frontmatter.js';

test('parses scalars, block lists and inline lists', () => {
  const fm = parseFrontmatter(
    [
      'id: outcome/x',
      'version: 3',
      'deterministic_seed: true',
      'tools:',
      '  - read_file',
      '  - search_files',
      'stages: [intake, act]',
    ].join('\n'),
  );
  assert.equal(fm['id'], 'outcome/x');
  assert.equal(fm['version'], 3);
  assert.equal(fm['deterministic_seed'], true);
  assert.deepEqual(fm['tools'], ['read_file', 'search_files']);
  assert.deepEqual(fm['stages'], ['intake', 'act']);
});

test('folds a > block scalar into one line and keeps | literal', () => {
  const fm = parseFrontmatter(
    ['statement: >', '  No unbounded results', '  enter model context.', 'strength: gate'].join('\n'),
  );
  assert.equal(fm['statement'], 'No unbounded results enter model context.');
  assert.equal(fm['strength'], 'gate');

  const literal = parseFrontmatter(['body: |', '  line one', '  line two'].join('\n'));
  assert.equal(literal['body'], 'line one\nline two');
});

test('strips comments outside quotes but not inside them', () => {
  const fm = parseFrontmatter(['id: a # trailing note', 'note: "keep # this"'].join('\n'));
  assert.equal(fm['id'], 'a');
  assert.equal(fm['note'], 'keep # this');
});

test('a header that cannot be parsed fails loudly rather than being misread', () => {
  assert.throws(() => parseFrontmatter('nested:\n  deep:\n    value: 1'), /indentation/);
  assert.throws(() => parseFrontmatter('just some prose'), /not "key: value"/);
});

test('splits frontmatter from body', () => {
  const doc = parseDocument('---\nid: a\n---\n# Title\n\nprose');
  assert.equal(doc.frontmatter['id'], 'a');
  assert.equal(doc.body, '# Title\n\nprose');
});

test('a document with no frontmatter is all body', () => {
  const doc = parseDocument('# Just a doc');
  assert.deepEqual(doc.frontmatter, {});
  assert.equal(doc.body, '# Just a doc');
});
