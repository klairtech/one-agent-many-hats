import assert from 'node:assert/strict';
import test from 'node:test';

import { extractClaims, reconcile } from '../src/engine/reconcile.js';
import type { Artifact } from '../src/tools/artifacts.js';

function artifact(over: Partial<Artifact>): Artifact {
  return {
    id: 'art_abc123def456',
    runId: 'r',
    kind: 'tool-result',
    tool: 'list_dir',
    createdAt: '',
    summary: '',
    payload: {},
    provenance: {},
    ...over,
  };
}

test('extracts numbers and paths, ignoring small integers and years', () => {
  const claims = extractClaims('There are 42 files in src/engine/run.ts, up from 2 last year in 2024.');
  const numbers = claims.filter((c) => c.kind === 'number').map((c) => c.token);
  const paths = claims.filter((c) => c.kind === 'path').map((c) => c.token);
  assert.deepEqual(numbers, ['42']);
  assert.ok(paths.includes('src/engine/run.ts'));
});

test('a number present in an artifact payload reconciles', () => {
  const claims = extractClaims('The file has 348 lines.');
  const report = reconcile(claims, [artifact({ payload: { path: 'a.ts', lines: 348 } })]);
  assert.equal(report.unsupported.length, 0);
});

test('a fabricated number does not reconcile', () => {
  const claims = extractClaims('The file has 999 lines.');
  const report = reconcile(claims, [artifact({ payload: { lines: 348 } })]);
  assert.equal(report.unsupported.length, 1);
  assert.equal(report.unsupported[0]?.token, '999');
});

test('formatting differences still reconcile', () => {
  const report = reconcile(extractClaims('It totals 1,234 bytes.'), [
    artifact({ payload: { bytes: 1234 } }),
  ]);
  assert.equal(report.unsupported.length, 0);

  const percent = reconcile(extractClaims('That is 26.4% of the total.'), [
    artifact({ payload: { share: 0.264 } }),
  ]);
  assert.equal(percent.unsupported.length, 0, 'a ratio stored as 0.264 supports "26.4%"');
});

test('an artifact citation reconciles only if that artifact exists', () => {
  const good = reconcile(extractClaims('see (art_abc123def456)'), [artifact({})]);
  assert.equal(good.unsupported.length, 0);

  const bad = reconcile(extractClaims('see (art_ffffffffffff)'), [artifact({})]);
  assert.equal(bad.unsupported.length, 1);
});

test('a path mentioned but never observed does not reconcile', () => {
  const report = reconcile(extractClaims('It is defined in src/secret/hidden.ts.'), [
    artifact({ summary: 'src/engine/run.ts', payload: { rel: 'src/engine/run.ts' } }),
  ]);
  assert.equal(report.unsupported.length, 1);
  assert.equal(report.unsupported[0]?.kind, 'path');
});

/**
 * A ratio is not a file. This started as a live run whose answer was correct in every
 * particular but was stamped "Unverified" because the model quoted the reviewer's own
 * "26/26 specifics reconciled" score, and 26/26 was read as a path that no artifact
 * contained. A gate that cries wolf on correct answers costs more than it protects.
 */
test('ratios and dates are not treated as file paths', () => {
  const claims = extractClaims('The guardian reported 26/26 specifics reconciled on 12/08/2026.');
  const paths = claims.filter((c) => c.kind === 'path');
  assert.deepEqual(paths, [], 'a ratio or date was claimed to be a path: ' + JSON.stringify(paths));

  // Real paths must still be caught, or the fix has traded one hole for another.
  const real = extractClaims('See src/engine/run.ts and packs/skills/outcome-answer.md');
  const tokens = real.filter((c) => c.kind === 'path').map((c) => c.token).sort();
  assert.deepEqual(tokens, ['packs/skills/outcome-answer.md', 'src/engine/run.ts']);

  // A path with digits in it is still a path.
  const mixed = extractClaims('the file logs/2026-08-11.inc has it');
  assert.ok(
    mixed.some((c) => c.kind === 'path' && c.token === 'logs/2026-08-11.inc'),
    'a path containing digits was dropped',
  );
});
