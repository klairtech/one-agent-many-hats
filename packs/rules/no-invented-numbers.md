---
id: rule/no-invented-numbers
statement: >
  Every number, path and quoted line in a delivered answer must be reconcilable against an
  artifact produced in this run. Unreconciled values block delivery once and force a
  correction pass; if they survive it, they are struck or disclosed, never shipped silently.
strength: gate
scope: [verify, deliver]
enforced_by: gates.numbersReconciled
on_violation: block_and_reshape
version: 1
history:
  - "v1 prompt: 'cite your evidence', in core/discipline. Held for the easy cases and failed exactly where it mattered — a plausible count in a summary sentence."
  - "v2 gate: reconciliation moved into a coded check at the delivery boundary."
---

The check tokenises the draft, extracts numeric and path-like literals, and resolves each
against the run's artifact summaries and derived values. Matching is deliberately generous
about formatting (thousands separators, percentages, trailing zeroes) and strict about
existence.

It is a heuristic, and heuristics have both error modes:

- **False positive** — a number that is genuinely reasoning ("three sub-questions"), not a
  claim about the workspace. Cost: one correction pass. Acceptable.
- **False negative** — a fabricated number that happens to appear in some artifact. The
  guardian hat is the other line of defence, which is why `review` exists on the outcome
  skills as well as this gate.

Blocking once and then disclosing, rather than blocking forever, is the paper's bounded
recovery: an honest gap beats an infinite retry.
