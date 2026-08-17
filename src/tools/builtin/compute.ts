/**
 * Deterministic computation and reconciliation.
 *
 * Paper §2.6.3: arithmetic in a tool is testable and citable; arithmetic in prose is
 * neither. `derive_metric` takes artifact *references*, not values, so the model cannot
 * launder a number it invented into what looks like a computation.
 */

import { HatsError } from '../../core/errors.js';
import type { ToolHandler, ToolResult } from '../types.js';
import { extractClaims, reconcile } from '../../engine/reconcile.js';

type Operation = 'sum' | 'count' | 'ratio' | 'growth' | 'share' | 'difference' | 'mean' | 'max' | 'min';

export const deriveMetric: ToolHandler = {
  spec: {
    name: 'derive_metric',
    description:
      'Compute a value from numbers held in artifacts produced earlier in this run. Use this for ALL arithmetic — never compute in prose. Inputs are artifact references plus a field path, so the result carries its provenance. Returns the value with its inputs and formula recorded.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['sum', 'count', 'ratio', 'growth', 'share', 'difference', 'mean', 'max', 'min'],
          description:
            'ratio = a/b. growth = (b-a)/a. share = a/(a+b). difference = b-a. Others take any number of inputs.',
        },
        inputs: {
          type: 'array',
          description: 'Values to operate on, each pulled from an artifact.',
          items: {
            type: 'object',
            properties: {
              artifact_id: { type: 'string', description: 'An art_... id from an earlier observation.' },
              field: {
                type: 'string',
                description:
                  'Dot path inside the artifact payload, e.g. "lines" or "0.size". Omit to use the payload itself if it is a number or an array of numbers.',
              },
              literal: {
                type: 'number',
                description:
                  'Escape hatch for a constant that is genuinely not from data (e.g. 100 for a percentage). Use sparingly — it is recorded as unsourced.',
              },
            },
            required: [],
          },
        },
        label: { type: 'string', description: 'What this value means, in three or four words.' },
      },
      required: ['operation', 'inputs', 'label'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    const operation = String(args['operation']) as Operation;
    const label = String(args['label']);
    const inputs = (args['inputs'] ?? []) as Array<Record<string, unknown>>;
    if (inputs.length === 0) {
      throw new HatsError('TOOL_INPUT_INVALID', 'derive_metric needs at least one input', {});
    }

    const values: number[] = [];
    const sources: Array<Record<string, unknown>> = [];

    for (const [index, input] of inputs.entries()) {
      if (typeof input['literal'] === 'number') {
        values.push(input['literal']);
        sources.push({ literal: input['literal'], sourced: false });
        continue;
      }
      // Neither an artifact nor a literal. The schema cannot express "one of these two"
      // in the subset we validate, so an input with neither is well-formed and then fails
      // deep inside with `no artifact ""` — which reads as a missing artifact rather than
      // as a malformed input, and sent runs looking for an id that was never the problem.
      const id = String(input['artifact_id'] ?? '');
      if (!id) {
        throw new HatsError(
          'TOOL_INPUT_INVALID',
          `input ${index + 1} has neither artifact_id nor literal. Give artifact_id to read a ` +
            `number out of something a tool already produced, or literal for a constant that ` +
            `genuinely is not from data.`,
          { index },
        );
      }
      const artifact = await ctx.artifacts.get(id);
      if (!artifact) {
        throw new HatsError(
          'TOOL_INPUT_INVALID',
          `no artifact "${id}" in this run — use an id from an earlier observation`,
          { id },
        );
      }
      const field = input['field'] === undefined ? '' : String(input['field']);
      const picked = pickNumbers(artifact.payload, field);
      if (picked.length === 0) {
        throw new HatsError(
          'TOOL_INPUT_INVALID',
          `artifact ${id}${field ? ` field "${field}"` : ''} holds no number`,
          { id, field },
        );
      }
      values.push(...picked);
      sources.push({ artifactId: id, field, count: picked.length });
    }

    const { value, formula } = compute(operation, values);
    const artifact = await ctx.artifacts.put({
      kind: 'derived',
      tool: 'derive_metric',
      summary: `${label}: ${format(value)}`,
      payload: { label, operation, value, inputs: values, formula },
      provenance: { operation, formula, sources },
    });

    return {
      summary: `${label} = ${format(value)}  (${formula})`,
      artifactId: artifact.id,
      payload: { value, formula },
    };
  },
};

export const checkConsistency: ToolHandler = {
  spec: {
    name: 'check_consistency',
    description:
      'Reconcile a draft answer against the artifacts of this run. Returns each number, path and quoted value in the draft with whether it is supported by evidence. Run this before delivering anything with specifics in it.',
    parameters: {
      type: 'object',
      properties: {
        draft: { type: 'string', description: 'The answer text you are about to deliver.' },
      },
      required: ['draft'],
    },
    mutating: false,
    network: false,
    minProfile: 'read-only',
  },
  async run(args, ctx): Promise<ToolResult> {
    const draft = String(args['draft']);
    const artifacts = ctx.artifacts.all();
    const claims = extractClaims(draft);
    const report = reconcile(claims, artifacts);

    const lines = report.checked.map(
      (c) => `${c.supported ? 'ok  ' : 'MISS'} ${c.kind} ${c.token}${c.supported ? ` (${c.foundIn})` : ''}`,
    );
    const verdict = report.unsupported.length === 0 ? 'PASS' : 'FAIL';
    return {
      summary:
        `${verdict}: ${report.checked.length - report.unsupported.length}/${report.checked.length} specifics reconciled against ${artifacts.length} artifacts.\n` +
        (lines.length > 0 ? lines.join('\n') : '(no specifics found in the draft)') +
        (report.unsupported.length > 0
          ? `\n\nUnsupported: ${report.unsupported.map((u) => u.token).join(', ')}. Either derive them with a tool, quote the artifact that has them, or remove the claim.`
          : ''),
      payload: report,
      provenance: { artifactCount: artifacts.length, verdict },
      // Deliberately not `failed: unsupported.length > 0`. A check that reports "1 of 5
      // claims does not reconcile" has worked perfectly — the verdict is its output, not
      // its failure. Marking it failed conflated "the tool broke" with "the tool found
      // something", and the completion gate then counted a *successful self-check* as a
      // failed tool call: a run that caught its own bad draft, fixed it, and delivered
      // correct numbers was made to append "unverified — 1 tool call failed" to an answer
      // that was right. The verdict is in the summary, where the model reads it.
      // [Seen in a live run, 2026-08-15: 1,284 rows, correct, disclosed as unverified.]
    };
  },
};

function pickNumbers(payload: unknown, field: string): number[] {
  const target = field ? getPath(payload, field) : payload;
  if (typeof target === 'number' && Number.isFinite(target)) return [target];
  if (Array.isArray(target)) {
    const nums = target.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (nums.length > 0) return nums;
    // An array of objects with the field name repeated inside, e.g. entries[].size
    // Only attempt property extraction if a field was actually specified.
    if (!field) return [];
    const leaf = field.split('.').pop() ?? '';
    const inner = target
      .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[leaf] : undefined))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return inner;
  }
  if (typeof target === 'string') {
    const n = Number(target);
    return Number.isFinite(n) ? [n] : [];
  }
  return [];
}

function getPath(root: unknown, dotted: string): unknown {
  let current: unknown = root;
  for (const key of dotted.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(key);
      if (Number.isInteger(index)) {
        current = current[index];
        continue;
      }
      // Project the key across the array: entries.size -> [size, size, ...]
      return current
        .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined))
        .filter((v) => v !== undefined);
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function compute(op: Operation, values: number[]): { value: number; formula: string } {
  const [a = 0, b = 0] = values;
  switch (op) {
    case 'sum':
      return { value: values.reduce((x, y) => x + y, 0), formula: `sum of ${values.length} values` };
    case 'count':
      return { value: values.length, formula: `count of inputs` };
    case 'mean':
      return {
        value: values.reduce((x, y) => x + y, 0) / values.length,
        formula: `mean of ${values.length} values`,
      };
    case 'max':
      return { value: Math.max(...values), formula: `max of ${values.length} values` };
    case 'min':
      return { value: Math.min(...values), formula: `min of ${values.length} values` };
    case 'difference':
      return { value: b - a, formula: `${format(b)} - ${format(a)}` };
    case 'ratio':
      assertNonZero(b, 'ratio');
      return { value: a / b, formula: `${format(a)} / ${format(b)}` };
    case 'growth':
      assertNonZero(a, 'growth');
      return { value: (b - a) / a, formula: `(${format(b)} - ${format(a)}) / ${format(a)}` };
    case 'share':
      assertNonZero(a + b, 'share');
      return { value: a / (a + b), formula: `${format(a)} / (${format(a)} + ${format(b)})` };
    default:
      throw new HatsError('TOOL_INPUT_INVALID', `unknown operation "${op}"`, {});
  }
}

function assertNonZero(v: number, op: string): void {
  if (v === 0) {
    throw new HatsError('TOOL_FAILED', `${op} would divide by zero — the denominator is 0`, {});
  }
}

function format(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

export const computeTools: ToolHandler[] = [deriveMetric, checkConsistency];
