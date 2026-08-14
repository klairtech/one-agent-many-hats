---
id: rule/lessons-behavioural-only
statement: >
  A distilled lesson may change how the agent works. It may never widen access, name a
  tool to be allowed, alter a profile, or modify a strength-3 boundary. Lessons that
  attempt it are refused at write time and recorded as refusals.
strength: code
scope: []
enforced_by: memory.lessons.assertBehavioural
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3, because feedback is untrusted input by construction (paper §4)."
---

Self-extension creates an attack surface: a user — careless, or adversarial, or quoting a
document that is itself adversarial — can try to teach the system falsehoods, and the
distillation pipeline would faithfully turn that into injected instruction.

Three properties bound the damage, and this rule is the third and hardest one:

1. **Scoping** localises it — a run-scoped or workspace-scoped lesson cannot reach another
   workspace.
2. **Confidence arithmetic** dampens it — a lesson contradicted by later outcomes loses
   weight and is disabled rather than argued with.
3. **This rule** caps it — even a fully trusted, high-confidence, human-accepted lesson
   cannot touch access. Access rules live at strength three, where no distilled lesson can
   reach.

Refusal is at write time, not read time, on purpose: a lesson store that contains
access-widening text and merely declines to apply it is one refactor away from applying it.
