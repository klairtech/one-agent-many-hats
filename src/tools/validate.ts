/**
 * JSON-Schema subset validator for tool inputs.
 *
 * Small on purpose: it validates exactly the shapes ToolSpec.parameters can express
 * (ADR-0003 forbids a validator dependency, and a partial validator that silently passes
 * bad input would be worse than none). Unknown keywords are ignored; unknown *properties*
 * are rejected, because a model inventing an argument name is a signal worth failing on.
 */

import { HatsError } from '../core/errors.js';
import type { JsonSchema } from '../providers/types.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateInput(
  toolName: string,
  schema: JsonSchema,
  input: unknown,
  passthrough = false,
): Record<string, unknown> {
  const issues: ValidationIssue[] = [];

  if (passthrough) {
    // Required-field check only; the owning server validates the rest.
    const obj = (input && typeof input === 'object' && !Array.isArray(input)
      ? input
      : {}) as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined || obj[key] === null) {
        issues.push({ path: `$.${key}`, message: 'is required' });
      }
    }
    if (issues.length > 0) {
      throw new HatsError(
        'TOOL_INPUT_INVALID',
        `${toolName}: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
        { tool: toolName, issues },
      );
    }
    return obj;
  }

  const value = coerceAndCheck(schema, input, '$', issues);
  if (issues.length > 0) {
    throw new HatsError(
      'TOOL_INPUT_INVALID',
      `${toolName}: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      { tool: toolName, issues },
    );
  }
  return (value ?? {}) as Record<string, unknown>;
}

function coerceAndCheck(
  schema: JsonSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): unknown {
  if (value === undefined || value === null) {
    if (schema.default !== undefined) return schema.default;
    return value;
  }

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ path, message: 'must be an object' });
        return value;
      }
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const props = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
          issues.push({ path: `${path}.${key}`, message: 'is required' });
        }
      }
      if (schema.additionalProperties === false || schema.properties) {
        for (const key of Object.keys(obj)) {
          if (!props[key]) {
            issues.push({ path: `${path}.${key}`, message: 'is not a known argument' });
          }
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        const got = obj[key];
        if (got === undefined) {
          if (sub.default !== undefined) out[key] = sub.default;
          continue;
        }
        out[key] = coerceAndCheck(sub, got, `${path}.${key}`, issues);
      }
      return out;
    }
    case 'array': {
      const arr = Array.isArray(value) ? value : [value];
      if (!schema.items) return arr;
      return arr.map((v, i) => coerceAndCheck(schema.items!, v, `${path}[${i}]`, issues));
    }
    case 'string': {
      const s = typeof value === 'string' ? value : String(value);
      checkEnum(schema, s, path, issues);
      return s;
    }
    case 'integer':
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        issues.push({ path, message: 'must be a number' });
        return value;
      }
      if (schema.type === 'integer' && !Number.isInteger(n)) {
        issues.push({ path, message: 'must be an integer' });
      }
      if (schema.minimum !== undefined && n < schema.minimum) {
        issues.push({ path, message: `must be >= ${schema.minimum}` });
      }
      if (schema.maximum !== undefined && n > schema.maximum) {
        issues.push({ path, message: `must be <= ${schema.maximum}` });
      }
      checkEnum(schema, n, path, issues);
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      issues.push({ path, message: 'must be a boolean' });
      return value;
    }
    default:
      return value;
  }
}

function checkEnum(
  schema: JsonSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push({ path, message: `must be one of ${schema.enum.map(String).join(', ')}` });
  }
}
