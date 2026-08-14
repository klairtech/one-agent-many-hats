/**
 * Chunking.
 *
 * Splitting on a fixed character count is the standard shortcut and it is why so much
 * retrieval returns a sentence with its subject in the previous chunk. This splits on
 * structure first — markdown headings, then blank-line paragraphs, then sentences — and
 * only falls back to hard slicing when a single unit is genuinely oversized.
 *
 * Every chunk carries the heading trail it sat under, so a retrieved paragraph arrives
 * with "## Install > ### macOS" attached and the model can cite where it came from.
 */

export interface Chunk {
  /** `path#3` — stable across rebuilds as long as the file has not changed. */
  id: string;
  path: string;
  index: number;
  text: string;
  /** Heading trail, outermost first. Empty for unstructured text. */
  headings: string[];
  startLine: number;
  endLine: number;
}

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

const DEFAULT_MAX = 1_400;
const DEFAULT_OVERLAP = 160;

export function chunkDocument(path: string, text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX;
  const overlap = opts.overlapChars ?? DEFAULT_OVERLAP;
  const lines = text.split('\n');

  const blocks = splitByStructure(lines);
  const chunks: Chunk[] = [];
  let index = 0;

  for (const block of blocks) {
    for (const piece of packUnits(block.units, maxChars, overlap)) {
      const trimmed = piece.text.trim();
      if (!trimmed) continue;
      chunks.push({
        id: `${path}#${index}`,
        path,
        index,
        text: trimmed,
        headings: block.headings,
        startLine: piece.startLine,
        endLine: piece.endLine,
      });
      index++;
    }
  }
  return chunks;
}

interface Unit {
  text: string;
  startLine: number;
  endLine: number;
}
interface Block {
  headings: string[];
  units: Unit[];
}

/** Markdown headings open a new block; fenced code is kept whole. */
function splitByStructure(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let headings: string[] = [];
  let units: Unit[] = [];
  let buffer: string[] = [];
  let bufferStart = 0;
  let inFence = false;

  const flushUnit = (endLine: number) => {
    if (buffer.length === 0) return;
    units.push({ text: buffer.join('\n'), startLine: bufferStart + 1, endLine: endLine + 1 });
    buffer = [];
  };
  const flushBlock = () => {
    if (units.length > 0) blocks.push({ headings: [...headings], units });
    units = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      if (buffer.length === 0) bufferStart = i;
      buffer.push(line);
      if (!inFence) flushUnit(i);
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushUnit(i - 1);
      flushBlock();
      const depth = (heading[1] ?? '#').length;
      headings = [...headings.slice(0, depth - 1), (heading[2] ?? '').trim()];
      continue;
    }

    if (line.trim() === '') {
      flushUnit(i - 1);
      continue;
    }
    if (buffer.length === 0) bufferStart = i;
    buffer.push(line);
  }
  flushUnit(lines.length - 1);
  flushBlock();

  if (blocks.length === 0) return [{ headings: [], units: [] }];
  return blocks;
}

/** Fill chunks up to the budget, carrying a tail of the previous one for continuity. */
function packUnits(units: Unit[], maxChars: number, overlap: number): Unit[] {
  const out: Unit[] = [];
  let current: Unit | null = null;

  for (const unit of units) {
    if (unit.text.length > maxChars) {
      if (current) {
        out.push(current);
        current = null;
      }
      out.push(...hardSplit(unit, maxChars, overlap));
      continue;
    }
    if (!current) {
      current = { ...unit };
      continue;
    }
    if (current.text.length + unit.text.length + 2 <= maxChars) {
      current = {
        text: `${current.text}\n\n${unit.text}`,
        startLine: current.startLine,
        endLine: unit.endLine,
      };
      continue;
    }
    out.push(current);
    const tail: string = overlap > 0 ? current.text.slice(-overlap) : '';
    current = {
      text: tail ? `${tail}\n\n${unit.text}` : unit.text,
      startLine: unit.startLine,
      endLine: unit.endLine,
    };
  }
  if (current) out.push(current);
  return out;
}

/** A single oversized unit — a minified line, a huge table — sliced on sentence ends. */
function hardSplit(unit: Unit, maxChars: number, overlap: number): Unit[] {
  const out: Unit[] = [];
  let cursor = 0;
  while (cursor < unit.text.length) {
    let end = Math.min(cursor + maxChars, unit.text.length);
    if (end < unit.text.length) {
      const window = unit.text.slice(cursor, end);
      const breakAt = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (breakAt > maxChars * 0.5) end = cursor + breakAt + 1;
    }
    out.push({ text: unit.text.slice(cursor, end), startLine: unit.startLine, endLine: unit.endLine });
    if (end >= unit.text.length) break;
    cursor = Math.max(end - overlap, cursor + 1);
  }
  return out;
}

/** A retrieved chunk should arrive knowing where it lives. */
export function citation(chunk: Chunk): string {
  const trail = chunk.headings.length > 0 ? ` — ${chunk.headings.join(' > ')}` : '';
  return `${chunk.path}:${chunk.startLine}-${chunk.endLine}${trail}`;
}
