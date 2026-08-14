/**
 * Every failure in this runtime carries a code and a context object.
 * REPO_RULES §5: never throw bare strings, never swallow.
 */

export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_MISSING'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_NO_TOOL_SUPPORT'
  | 'PROVIDER_UNAUTHORIZED'
  | 'REGISTRY_INVALID'
  | 'REGISTRY_NOT_FOUND'
  | 'REGISTRY_IMMUTABLE'
  | 'TOOL_UNKNOWN'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_INPUT_INVALID'
  | 'TOOL_TIMEOUT'
  | 'TOOL_FAILED'
  | 'GATE_BLOCKED'
  | 'SCOPE_DENIED'
  | 'NETWORK_DENIED'
  | 'APPROVAL_DENIED'
  | 'SANDBOX_FAILED'
  | 'SANDBOX_TIMEOUT'
  | 'SANDBOX_INVALID_OUTPUT'
  | 'BUDGET_EXHAUSTED'
  | 'LESSON_REFUSED'
  | 'CLARIFICATION_REQUIRED'
  | 'INTERRUPTED'
  | 'INTERNAL';

export class HatsError extends Error {
  readonly code: ErrorCode;
  readonly context: Record<string, unknown>;
  /** Rule id, when this failure is a rule enforcement point. REPO_RULES §4.8. */
  readonly ruleId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    ruleId?: string,
  ) {
    super(message);
    this.name = 'HatsError';
    this.code = code;
    this.context = context;
    if (ruleId) this.ruleId = ruleId;
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, ruleId: this.ruleId, context: this.context };
  }
}

export function isHatsError(e: unknown): e is HatsError {
  return e instanceof HatsError;
}

/** Normalise anything thrown into a HatsError so audit entries are uniform. */
export function toHatsError(e: unknown, fallback: ErrorCode = 'INTERNAL'): HatsError {
  if (isHatsError(e)) return e;
  if (e instanceof Error) return new HatsError(fallback, e.message, { stack: e.stack });
  return new HatsError(fallback, String(e), {});
}
