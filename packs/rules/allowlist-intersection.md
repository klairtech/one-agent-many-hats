---
id: rule/allowlist-intersection
statement: >
  The effective tool allowlist is the intersection of the active skill's tools, the
  profile's permitted surface, and the platform registry. Never a union. A skill cannot
  grant a tool the profile withholds, and a profile cannot grant a tool the skill does not
  list.
strength: code
scope: []
enforced_by: executor.allowlist
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3. Prompt-level allowlists are decoration; the model that ignores them is exactly the model the allowlist exists for."
---

Composition happens once at run start and once per step (paper §2.6.4). The executor
re-checks on every call regardless, because the composed list is an optimisation and the
check is the boundary.

A denied call returns a structured error naming this rule. The model sees the denial, can
reason about it, and cannot route around it — there is no second path to a tool handler.
