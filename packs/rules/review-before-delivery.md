---
id: rule/review-before-delivery
statement: >
  When the active outcome skill declares review as guardian or critic, that hat must run
  and return a verdict before the answer is delivered. A run cannot advance past verify by
  asserting that it reviewed itself.
strength: gate
scope: [verify, deliver]
enforced_by: gates.reviewCompleted
on_violation: block
version: 1
history:
  - "v1 gate: born as a gate. The prompt version of this rule is the model saying 'I have checked this', which is not a check."
---

The review requirement is a field in the skill header, so it is versioned and reviewable
alongside the playbook it belongs to. The gate reads the field and the run record; the
model's opinion about whether review is necessary is not an input.

The guardian's and critic's verdicts are recorded as observations on the one timeline, not
in a side channel — they are hats on the same loop, not peer agents. That is what makes
"which step introduced this error" answerable afterwards.
