/**
 * PDFs and images.
 *
 * The assertion that matters is not that extraction works — it is that when it does not
 * work, nothing plausible comes out. A half-decoded PDF returns text-shaped noise, and
 * text-shaped noise is quotable: the model cites it, the answer carries it, and the reader
 * has no way to tell it from the document.
 */

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { extractPdfText, looksGarbled, readImage, readPdf } from '../src/tools/builtin/binary.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { PathGuard } from '../src/core/paths.js';

async function workspace(): Promise<string> {
  return fsp.mkdtemp(path.join(await fsp.realpath(process.env['TMPDIR'] ?? '/tmp'), 'hats-bin-'));
}

const ctxFor = (ws: string) =>
  ({ config: DEFAULT_CONFIG, workspaceRoot: ws, guard: new PathGuard([ws]), runId: 'run_test' }) as never;

test('garbled extraction is reported as nothing, not as text', () => {
  // The real failure, measured on a Word-generated PDF: subset fonts with no usable
  // ToUnicode map produce long unbroken runs with almost no spaces.
  const garbage = 'PPPPeriodc fmfarPPeriodrec ifmeainmcRiiPeriodc fmrrodcanRcpttrocaocanick#|nmai|ae#ictscanckeatntgteodc'.repeat(4);
  assert.equal(looksGarbled(garbage), true, 'font-table noise was accepted as text');

  assert.equal(
    looksGarbled('The quarterly report shows revenue grew by twelve per cent across every region we measure.'),
    false,
    'ordinary prose was rejected',
  );

  // A script without spaces must not be judged by its spaces.
  assert.equal(
    looksGarbled('四半期報告書によれば、収益は前年同期比で十二パーセント増加しました。これは当社が測定しているすべての地域で同時に起きた初めての出来事です。'),
    false,
    'Japanese prose was rejected for having no spaces',
  );

  // Too short to judge is not the same as bad.
  assert.equal(looksGarbled('ok'), false);
});

test('a PDF with an uncompressed content stream gives its text back', () => {
  // Written by hand so the test owns its input: one stream, standard encoding, no fonts to
  // subset and nothing to decode wrong.
  const content = 'BT /F1 12 Tf 72 720 Td (Revenue was 1,284 units.) Tj 0 -14 Td (Codename OSPREY-77.) Tj ET';
  const pdf = Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Page>>endobj\n2 0 obj<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj\n%%EOF\n`,
    'latin1',
  );
  const out = extractPdfText(pdf);
  assert.match(out.text, /Revenue was 1,284 units\./);
  assert.match(out.text, /Codename OSPREY-77\./);
  assert.equal(looksGarbled(out.text), false);
});

/**
 * The bug that made every word-processor PDF unreadable.
 *
 * A subset font numbers its glyphs from zero for its own use, so code 1 is "A" in one font
 * and "X" in the next. An earlier version merged every ToUnicode map in the file into one
 * dictionary, so the last font loaded decoded everybody's text. The output was text-shaped
 * and wrong, which is worse than an error.
 */
test('two fonts with conflicting glyph codes are decoded by their own maps', () => {
  const cmap = (pairs: Array<[string, string]>) =>
    `/CIDInit /ProcSet findresource begin 1 beginbfchar\n` +
    pairs.map(([code, ch]) => `<${code}> <${ch}>`).join('\n') +
    `\nendbfchar end`;

  // Font A: 0001 -> H, 0002 -> I.  Font B: the same codes -> N, O.
  const objs = [
    `1 0 obj<</Type/Page/Resources<</Font<</F1 3 0 R/F2 5 0 R>>>>/Contents 7 0 R>>endobj`,
    `3 0 obj<</Type/Font/ToUnicode 4 0 R>>endobj`,
    `4 0 obj<</Length 1>>\nstream\n${cmap([['0001', '0048'], ['0002', '0049']])}\nendstream endobj`,
    `5 0 obj<</Type/Font/ToUnicode 6 0 R>>endobj`,
    `6 0 obj<</Length 1>>\nstream\n${cmap([['0001', '004E'], ['0002', '004F']])}\nendstream endobj`,
    `7 0 obj<</Length 1>>\nstream\nBT /F1 12 Tf <00010002> Tj /F2 12 Tf <00010002> Tj ET\nendstream endobj`,
  ];
  const pdf = Buffer.from(`%PDF-1.4\n${objs.join('\n')}\n%%EOF\n`, 'latin1');

  const out = extractPdfText(pdf).text;
  assert.match(out, /HI/, 'the first font decoded through the wrong table');
  assert.match(out, /NO/, 'the second font decoded through the wrong table');
  assert.ok(!/HIHI|NONO/.test(out), `one font's map was applied to both runs: ${out}`);
});

test('a font program is not mistaken for the document', () => {
  // A stream of binary with no text operators: this is what leaked into the first version,
  // several kilobytes of font tables presented as the contents of the file.
  const fontish = Array.from({ length: 600 }, (_, i) => String.fromCharCode(i % 256)).join('');
  const pdf = Buffer.from(`%PDF-1.4\nstream\n${fontish}\nendstream\n%%EOF\n`, 'latin1');
  assert.equal(extractPdfText(pdf).text, '', 'binary stream content reached the output');
});

test('a file that is not a PDF is refused before it is parsed', async () => {
  const ws = await workspace();
  try {
    await fsp.writeFile(path.join(ws, 'notes.txt'), 'plain text, no header');
    await assert.rejects(readPdf.run({ path: 'notes.txt' }, ctxFor(ws)), /not a PDF/);
  } finally {
    await fsp.rm(ws, { recursive: true, force: true });
  }
});

test('an image is attached as pixels, not described as text', async () => {
  const ws = await workspace();
  try {
    // A 1x1 PNG. The content does not matter; where it ends up does.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await fsp.writeFile(path.join(ws, 'chart.png'), png);

    const out = await readImage.run({ path: 'chart.png' }, ctxFor(ws));
    assert.equal(out.images?.length, 1, 'the image did not reach the result');
    assert.equal(out.images?.[0]?.mediaType, 'image/png');
    assert.equal(out.images?.[0]?.data, png.toString('base64'), 'the bytes were altered on the way');
    // The base64 must not be in the summary: that is the text the model reads, and a
    // megabyte of it there is both useless and expensive.
    assert.ok(!out.summary.includes('iVBOR'), 'base64 leaked into the summary');

    await assert.rejects(readImage.run({ path: 'notes.svg' }, ctxFor(ws)), /not an image this can read/);
  } finally {
    await fsp.rm(ws, { recursive: true, force: true });
  }
});
