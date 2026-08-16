/**
 * Files that are not text: PDFs and images.
 *
 * `read_file` refuses both, correctly — it returns numbered lines and there are none. But
 * refusing was the whole answer, so a workspace containing a PDF report or a screenshot of
 * a failing dashboard was, to this runtime, a workspace containing nothing.
 *
 * The two are unalike in the only way that matters. A PDF *contains* text and the work is
 * getting it out, here, with no model involved. An image contains nothing extractable, so
 * the work is handing the pixels to a model that can look at them — which means it depends
 * on the bound model, and the tool says so rather than pretending otherwise.
 */

import fsp from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

import { HatsError } from '../../core/errors.js';
import { shapeText } from '../artifacts.js';
import type { ToolHandler, ToolResult } from '../types.js';

const MAX_PDF_BYTES = 40 * 1024 * 1024;
/** Base64 inflates by a third and every byte crosses into the prompt. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Text out of a PDF, with no dependency and no illusions.
 *
 * A PDF is a container of compressed streams; the text lives inside them as operands to
 * `Tj`, `TJ`, `'` and `"`. This inflates every Flate stream it can and pulls the operands
 * out. What it does *not* do is lay text out: PDF has no concept of a word or a paragraph,
 * only glyphs at coordinates, so reading order follows the order the generator wrote them
 * — usually right, occasionally not, and never for a multi-column page.
 *
 * It also cannot read a scanned page. Those are images of text with no text in them, and
 * the honest output is nothing, said clearly, rather than a plausible fragment.
 */
export function extractPdfText(buf: Buffer): { text: string; streams: number; decoded: number } {
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  const parts: string[] = [];
  let streams = 0;
  let decoded = 0;
  let at = 0;
  const cmap = new Map<number, string>();

  while (at < buf.length) {
    const start = buf.indexOf(marker, at);
    if (start < 0) break;
    const end = buf.indexOf(endMarker, start);
    if (end < 0) break;
    streams++;

    // Past "stream" and its end-of-line, which the spec allows to be CRLF or LF.
    let from = start + marker.length;
    if (buf[from] === 0x0d) from++;
    if (buf[from] === 0x0a) from++;

    const raw = buf.subarray(from, end);
    at = end + endMarker.length;

    let body: Buffer;
    try {
      body = inflateSync(raw);
      decoded++;
    } catch {
      // Not Flate, or an image stream, or encrypted. Uncompressed content streams exist and
      // are worth trying; anything binary is rejected by isContentStream below.
      body = raw;
    }

    const latin = body.toString('latin1');

    // A ToUnicode CMap is how a subset font says what its glyph codes mean. Collected from
    // every stream first, because a font's map may appear after the page that uses it.
    if (latin.includes('beginbfchar') || latin.includes('beginbfrange')) {
      collectCMap(latin, cmap);
      continue;
    }

    // Only content streams. Font programs, colour profiles, XML metadata and image data all
    // contain byte sequences that look like PDF strings, and the first version of this
    // returned several kilobytes of font tables as though they were the document.
    if (!isContentStream(latin)) continue;

    const text = readTextOperators(latin);
    if (text.trim()) parts.push(text);
  }

  const joined = parts.join('\n');
  const mapped = cmap.size > 0 ? applyCMap(joined, cmap) : joined;
  return {
    text: mapped.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    streams,
    decoded,
  };
}

/** The operand side of Tj/TJ/'/" — literal `(...)` strings and hex `<...>` strings. */
function readTextOperators(content: string): string {
  const out: string[] = [];
  let i = 0;
  let line = '';

  const literal = (): string => {
    // Starts on the '('. PDF strings nest parentheses and escape with backslash, so this
    // cannot be a regex without getting "(a (b) c)" wrong.
    let depth = 1;
    let s = '';
    i++;
    while (i < content.length && depth > 0) {
      const c = content[i] as string;
      if (c === '\\') {
        const next = content[i + 1] as string;
        const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        if (next >= '0' && next <= '7') {
          const oct = content.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? '';
          s += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
          continue;
        }
        s += ESCAPES[next] ?? next;
        i += 2;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
      s += c;
      i++;
    }
    i++;
    return s;
  };

  const hex = (): string => {
    const close = content.indexOf('>', i);
    if (close < 0) {
      i = content.length;
      return '';
    }
    const digits = content.slice(i + 1, close).replace(/[^0-9a-fA-F]/g, '');
    i = close + 1;
    let s = '';
    // Two digits per byte for simple fonts; four for the identity-encoded ones, where the
    // high byte is almost always zero and dropping it recovers ASCII.
    const step = digits.length % 4 === 0 && digits.length > 2 ? 4 : 2;
    for (let k = 0; k + step <= digits.length; k += step) {
      const code = parseInt(digits.slice(k, k + step), 16);
      if (code > 0) s += String.fromCharCode(code);
    }
    return s;
  };

  while (i < content.length) {
    const c = content[i] as string;
    if (c === '(') {
      line += literal();
      continue;
    }
    if (c === '<' && content[i + 1] !== '<') {
      line += hex();
      continue;
    }
    // Td, TD, T* and ' all move to a new line. Treating them as line breaks is the whole of
    // the layout model, which is why a two-column page comes out interleaved.
    if ((c === 'T' && (content[i + 1] === 'd' || content[i + 1] === 'D' || content[i + 1] === '*')) || c === "'") {
      if (line.trim()) out.push(line.trim());
      line = '';
      i += 2;
      continue;
    }
    i++;
  }
  if (line.trim()) out.push(line.trim());
  return out.join('\n');
}

/**
 * Is this the drawing instructions for a page, or something else that happens to be a
 * compressed stream?
 *
 * A content stream is text-drawing operators, so it opens a text object with `BT` and uses
 * `Tj`, `TJ` or `Tf`. A font program contains none of those and *is* mostly bytes, which is
 * the second test: a stream that is largely unprintable is not instructions.
 */
function isContentStream(body: string): boolean {
  const head = body.slice(0, 4_000);
  const hasTextOps = /\bBT\b/.test(head) || /\bT[jJf]\b/.test(head);
  if (!hasTextOps) return false;
  let printable = 0;
  const sample = body.slice(0, 2_000);
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  }
  return printable / Math.max(1, sample.length) > 0.8;
}

/**
 * The font's own answer to "what character is glyph 3?".
 *
 * Without this, a PDF written by a word processor comes back as mojibake — the codes in the
 * content stream are positions in an embedded subset, not characters, so glyph 3 might be
 * "a" in one font and "%" in the next. The first version of this returned that mojibake as
 * though it were the document, which is worse than returning nothing: it is quotable.
 */
function collectCMap(body: string, into: Map<number, string>): void {
  const decode = (hex: string): string => {
    const digits = hex.replace(/[^0-9a-fA-F]/g, '');
    let s = '';
    for (let i = 0; i + 4 <= digits.length; i += 4) {
      const code = parseInt(digits.slice(i, i + 4), 16);
      if (code > 0) s += String.fromCharCode(code);
    }
    return s || (digits.length ? String.fromCharCode(parseInt(digits.slice(0, 2), 16)) : '');
  };

  for (const block of body.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const pair of block.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g) ?? []) {
      const m = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/.exec(pair);
      if (m?.[1] && m[2]) into.set(parseInt(m[1], 16), decode(m[2]));
    }
  }

  for (const block of body.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    const RANGE = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = RANGE.exec(block))) {
      const from = parseInt(m[1] as string, 16);
      const to = parseInt(m[2] as string, 16);
      const base = parseInt(m[3] as string, 16);
      // A runaway range would fill the heap for a malformed file and gain nothing.
      if (to - from > 65_535) continue;
      for (let c = from; c <= to; c++) into.set(c, String.fromCharCode(base + (c - from)));
    }
  }
}

function applyCMap(text: string, cmap: Map<number, string>): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const mapped = cmap.get(code);
    out += mapped !== undefined ? mapped : text[i];
  }
  return out;
}

/**
 * Does this read as language, or as noise a font table produced?
 *
 * Half-working extraction is the dangerous outcome. It returns something, the model quotes
 * it, and the quotation is meaningless — worse than a gap, because a gap is visible.
 *
 * Measured on two real files rather than guessed. A PDF whose fonts decode gives a space
 * ratio around 0.47 and no tokens over fifteen characters; one whose subset fonts do not
 * gives 0.008 and half its tokens over fifteen, because unmapped glyph runs concatenate
 * with nothing to separate them. The gap between those is wide enough to sit a threshold in
 * the middle of and never think about again.
 *
 * The space test is skipped for scripts that do not use spaces. Chinese and Japanese prose
 * scores like garbage on it and is perfectly good text.
 */
export function looksGarbled(text: string): boolean {
  const sample = text.slice(0, 4_000);
  if (sample.length < 60) return false;

  let printable = 0;
  let cjk = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 160) printable++;
    // CJK ideographs, hiragana, katakana, Hangul.
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) cjk++;
  }
  if (printable / sample.length < 0.85) return true;
  if (cjk / sample.length > 0.2) return false;

  const tokens = sample.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const overlong = tokens.filter((t) => t.length > 15).length / tokens.length;
  const spaces = (sample.match(/\s/g) ?? []).length / sample.length;
  return spaces < 0.05 || overlong > 0.3;
}

export const readPdf: ToolHandler = {
  spec: {
    name: 'read_pdf',
    description:
      'Extract the text of a PDF in the workspace. Returns the text it can recover with the page count, and says so plainly when it recovers nothing — a scanned PDF is images of text and contains no text to find. Reading order follows the order the generator wrote the glyphs, which is right for ordinary prose and unreliable for multi-column layouts and tables.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the PDF, relative to the workspace root.' },
        max_chars: {
          type: 'integer',
          description: 'Cap on the text returned in the summary. The whole extraction is always in the artifact.',
          minimum: 500,
          maximum: 200_000,
        },
      },
      required: ['path'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const file = ctx.guard.resolve(String(args['path']), ctx.workspaceRoot);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new HatsError('TOOL_FAILED', `${args['path']} is not a file`, { file });
    if (stat.size > MAX_PDF_BYTES) {
      throw new HatsError('TOOL_FAILED', `${args['path']} is ${Math.round(stat.size / 1e6)}MB, over the 40MB cap`, {});
    }

    const buf = await fsp.readFile(file);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HatsError('TOOL_INPUT_INVALID', `${args['path']} is not a PDF — it does not start with %PDF-`, {});
    }

    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length || 1;
    const { text, streams, decoded } = extractPdfText(buf);

    if (text && looksGarbled(text)) {
      return {
        summary:
          `${args['path']}: ${pages} page(s). Text was found but could not be decoded into ` +
          `readable characters — the file embeds subset fonts whose glyph codes have no ` +
          `usable ToUnicode map, so what came out is noise rather than words. Reporting ` +
          `nothing rather than something: a garbled quotation is worse than a gap. Ask for ` +
          `the source document, or a copy exported with text preserved.`,
        payload: { pages, streams, decoded, text: '', garbled: true },
        provenance: { file, pages, garbled: true },
        failed: true,
      };
    }

    if (!text) {
      return {
        summary:
          `${args['path']}: ${pages} page(s), ${streams} streams, and no extractable text. ` +
          `That normally means it is a scan — images of text, with no text in the file. ` +
          `Nothing here can read it; say so rather than guessing at the contents.`,
        payload: { pages, streams, decoded, text: '' },
        provenance: { file, pages },
        failed: true,
      };
    }

    const head = shapeText(text, Number(args['max_chars'] ?? ctx.config.limits.maxToolOutputChars), 'The whole extraction is in the artifact.');
    return {
      summary: `${args['path']}: ${pages} page(s), ${text.length} characters of text.\n${head.summary}`,
      payload: { pages, streams, decoded, text },
      provenance: { file, pages, streams, decoded },
    };
  },
};

export const readImage: ToolHandler = {
  spec: {
    name: 'read_image',
    description:
      'Look at an image in the workspace — a screenshot, a diagram, a chart, a photograph of a whiteboard. The image is passed to the model, so this works only on a model that can see; on one that cannot, the call reports what the file is and nothing about what it shows. Describe what you need from it in the same step, because the image costs tokens every time it is sent.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the image, relative to the workspace root. png, jpg, gif or webp.' },
      },
      required: ['path'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },

  async run(args, ctx): Promise<ToolResult> {
    const rel = String(args['path']);
    const file = ctx.guard.resolve(rel, ctx.workspaceRoot);
    const ext = rel.split('.').pop()?.toLowerCase() ?? '';
    const mediaType = IMAGE_TYPES[ext];
    if (!mediaType) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `${rel} is not an image this can read (${Object.keys(IMAGE_TYPES).join(', ')})`,
        { path: rel },
      );
    }

    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new HatsError('TOOL_FAILED', `${rel} is not a file`, { file });
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new HatsError(
        'TOOL_FAILED',
        `${rel} is ${Math.round(stat.size / 1e6)}MB and the cap is 5MB — base64 grows it by a third and all of it enters the prompt`,
        {},
      );
    }

    const buf = await fsp.readFile(file);
    return {
      summary: `${rel} — ${mediaType}, ${Math.round(stat.size / 1024)}KB. The image follows; say what you can see in it.`,
      payload: { path: rel, mediaType, bytes: stat.size },
      provenance: { file, mediaType },
      images: [{ mediaType, data: buf.toString('base64') }],
    };
  },
};

export const binaryTools = [readPdf, readImage];
