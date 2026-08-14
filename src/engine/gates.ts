/**
 * Enforcement points.
 *
 * `ENFORCEMENT_POINTS` is the audit surface for paper §2.6.2: every rule of strength
 * `gate` or `code` must name one of these, and the registry refuses to load if it names
 * something that does not exist. That turns "enforced_by: executor.allowlist" from a
 * comment into a claim you can check.
 */

import type { Artifact } from '../tools/artifacts.js';
import { extractClaims, reconcile, type ReconcileReport } from './reconcile.js';
import { completionClaimed } from './vigilance.js';
import type { ToolObservation } from '../tools/types.js';

/**
 * Every named enforcement point in this runtime, and where it actually lives.
 * Adding a rule with a new `enforced_by` means adding the code and the name here.
 */
export const ENFORCEMENT_POINTS: Record<string, string> = {
  'core.PathGuard': 'src/core/paths.ts — PathGuard.resolve',
  'core.net.assertToolNetworkAllowed': 'src/core/net.ts',
  'config.profile': 'src/core/config.ts + Executor profile check (no setter exists)',
  'executor.allowlist': 'src/tools/executor.ts — step 2',
  'executor.approval': 'src/tools/executor.ts — step 7',
  'executor.result_shaper': 'src/tools/executor.ts — step 9 + src/tools/artifacts.ts shapeText',
  'sandbox.runner': 'runtime/sandbox-runner.mjs + src/tools/sandbox/sandbox.ts',
  'memory.lessons.assertBehavioural': 'src/memory/lessons.ts',
  'registry.proposals': 'src/registry/proposals.ts + src/tools/builtin/propose.ts',
  'gates.numbersReconciled': 'src/engine/gates.ts — numbersReconciled',
  'gates.reviewCompleted': 'src/engine/gates.ts — reviewCompleted',
  'gates.sandboxOutputValidated': 'src/engine/gates.ts — sandboxOutputValidated',
  'gates.completionSupported': 'src/engine/gates.ts — completionSupported',
};

export function knownEnforcementPoints(): Set<string> {
  return new Set(Object.keys(ENFORCEMENT_POINTS));
}

export interface GateFinding {
  gate: string;
  ruleId: string;
  passed: boolean;
  detail: string;
  /** What the loop should do about it. */
  backtrack?: string;
}

export interface VerificationInput {
  /** What the tools actually did, so a claim can be checked against it. */
  observations?: ToolObservation[];
  draft: string;
  artifacts: Artifact[];
  /** Set when the active skill declares review: guardian | critic. */
  reviewRequired: 'none' | 'guardian' | 'critic';
  reviewVerdict?: { role: string; verdict: string; detail: string };
  usedTools: boolean;
}

/**
 * rule/no-invented-numbers. Heuristic by nature — both error modes are documented in the
 * rule. Generous about formatting, strict about existence.
 */
export function numbersReconciled(input: VerificationInput): GateFinding & { report: ReconcileReport } {
  const report = reconcile(extractClaims(input.draft), input.artifacts);
  const passed = report.unsupported.length === 0;
  return {
    gate: 'gates.numbersReconciled',
    ruleId: 'rule/no-invented-numbers',
    passed,
    report,
    detail: passed
      ? `${report.checked.length} specifics reconciled`
      : `unreconciled: ${report.unsupported.map((u) => u.token).join(', ')}`,
    ...(passed
      ? {}
      : {
          backtrack:
            'Each unreconciled value must be derived with a tool, quoted from an artifact, or removed. Do not restate it and assert that it is correct.',
        }),
  };
}

/** rule/review-before-delivery. The model asserting it reviewed itself is not a review. */
export function reviewCompleted(input: VerificationInput): GateFinding {
  if (input.reviewRequired === 'none') {
    return {
      gate: 'gates.reviewCompleted',
      ruleId: 'rule/review-before-delivery',
      passed: true,
      detail: 'no review required by the active skill',
    };
  }
  const verdict = input.reviewVerdict;
  if (!verdict) {
    return {
      gate: 'gates.reviewCompleted',
      ruleId: 'rule/review-before-delivery',
      passed: false,
      detail: `${input.reviewRequired} review has not run`,
      backtrack: `run the ${input.reviewRequired} pass`,
    };
  }
  const failed = /^(fail|revise)/i.test(verdict.verdict.trim());
  return {
    gate: 'gates.reviewCompleted',
    ruleId: 'rule/review-before-delivery',
    passed: !failed,
    detail: `${verdict.role}: ${verdict.verdict}`,
    ...(failed ? { backtrack: verdict.detail } : {}),
  };
}

/**
 * rule/sandbox-output-validated (via rule/sandbox-isolation's validation step): a draft
 * may not cite a sandbox artifact whose output failed validation.
 */
export function sandboxOutputValidated(input: VerificationInput): GateFinding {
  const cited = new Set(input.draft.match(/\bart_[a-f0-9]{6,}\b/g) ?? []);
  const bad = input.artifacts.filter(
    (a) => cited.has(a.id) && a.kind === 'sandbox' && a.provenance['validated'] !== true,
  );
  return {
    gate: 'gates.sandboxOutputValidated',
    ruleId: 'rule/sandbox-isolation',
    passed: bad.length === 0,
    detail:
      bad.length === 0
        ? 'no unvalidated sandbox output is cited'
        : `cites unvalidated sandbox output: ${bad.map((b) => b.id).join(', ')}`,
    ...(bad.length === 0
      ? {}
      : { backtrack: 'Recompute those values or report the gap; unvalidated output is not evidence.' }),
  };
}

export function runVerificationGates(input: VerificationInput): GateFinding[] {
  const findings: GateFinding[] = [reviewCompleted(input), sandboxOutputValidated(input)];
  if (input.usedTools) findings.push(numbersReconciled(input));
  if (input.observations) findings.push(completionSupported(input));
  return findings;
}

/**
 * "Done" is a claim like any other. A run that processed 11 of 12 customers and reported
 * all 144 records complete was not lying — it believed it, which is why the belief cannot
 * be the check. This compares the claim against what the tools actually did.
 */
function completionSupported(input: VerificationInput): GateFinding {
  const check = completionClaimed(input.draft, input.observations ?? []);
  return {
    gate: 'gates.completionSupported',
    ruleId: 'rule/completion-must-be-observed',
    passed: check.ok,
    detail: check.detail,
    ...(check.ok
      ? {}
      : { backtrack: 'name the part that did not complete, or verify it before claiming it' }),
  };
}

/** What the loop tells the model when a gate blocks. Specific, and one message. */
export function renderGateFeedback(findings: GateFinding[]): string {
  const failed = findings.filter((f) => !f.passed);
  if (failed.length === 0) return '';
  return [
    'A delivery gate blocked this answer. Fix these, then produce the answer again:',
    ...failed.map((f) => `- [${f.ruleId}] ${f.detail}${f.backtrack ? ` -> ${f.backtrack}` : ''}`),
  ].join('\n');
}

/** After the recovery budget is spent, the answer ships with the gap disclosed. */
export function renderGateDisclosure(findings: GateFinding[]): string {
  const failed = findings.filter((f) => !f.passed);
  if (failed.length === 0) return '';
  return [
    '',
    '---',
    '**Unverified in this answer** (delivery gates that did not pass after a correction attempt):',
    ...failed.map((f) => `- ${f.detail} _(${f.ruleId})_`),
  ].join('\n');
}
