---
id: rule/profile-not-model-selectable
statement: >
  The execution profile (read-only | assisted | trusted) is set by CLI flag or config file
  only. No tool, skill header, distilled lesson or message content can change it, and it
  cannot change mid-run.
strength: code
scope: []
enforced_by: config.profile
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3. ADR-0005 makes the profile the thing that decides the worst case, which makes it exactly the thing an injection would aim at."
---

The profile is read once at run start into the run record and the executor closes over it.
There is no setter.

This is the rule that keeps ADR-0005 honest. Three profiles are only a defensible design if
the boundary between them is structural — if a persuasive paragraph in a README could move
a run from `read-only` to `trusted`, the profiles would be labels rather than boundaries.
