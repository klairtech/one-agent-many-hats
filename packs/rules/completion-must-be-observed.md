---
id: rule/completion-must-be-observed
statement: >
  An answer may not claim it finished a whole set — all, every, each, complete — while tool
  calls failed during the run. It blocks once and forces a correction that either names the
  part that did not complete or verifies the set before claiming it.
strength: gate
scope: [verify, deliver]
enforced_by: gates.completionSupported
on_violation: block_and_reshape
version: 1
history:
  - "v1 gate: added after 726 unattended runs where the most damaging failures were runs reporting success they had not achieved — 11 of 12 customers processed, reported as 144 of 144."
---

# Completion is a claim, and claims need evidence

"Done" is the least reliable sentence an agent produces, because it is the one thing it
cannot check from where it stands.

Observed across 726 unattended runs: one run processed 11 of 12 customers and reported all
144 records complete. Another rewrote two dozen files from memory instead of opening them
and signed off. Neither was lying — both believed it. That is precisely why the belief
cannot be the check, and why a pipeline that reads the agent's own success report is not
checking anything.

## What this blocks

A draft that asserts completeness — *all*, *every*, *each*, *complete*, *entire*, *nothing
left* — while tool calls failed during the run. Once, with the failing tools named. The
corrected answer either says which part did not complete, or verifies the whole set first.

## What it deliberately does not do

It does not fire on every use of the word "all". A gate that blocks ordinary prose is a gate
someone switches off within a week, and a switched-off gate protects nothing. The narrow
version that fires rarely and correctly is worth more than the thorough one that cries wolf.

## What it cannot catch

A run where every tool succeeded and the agent still summarised eleven items as twelve. For
that, the number itself must reconcile against an artifact — which is
`rule/no-invented-numbers`, a different gate. These two overlap on purpose; the failure they
guard against is common enough to deserve two independent checks.
