---
id: rule/proposals-not-live
statement: >
  Agent writes to the registry go to registry/proposals/** and nowhere else. The live
  skill, rule and tool catalogues are written only by human promotion. Deletes are denied;
  superseded entries are archived and versions accumulate.
strength: code
scope: []
enforced_by: registry.proposals
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3. This is the difference between a system that grows and a system that rewrites itself."
---

A system that rewrites its own capabilities and constraints without gates is not
autonomous; it is unaccountable. The trust argument of this whole architecture rests on the
trinity remaining reviewable, which requires that what runs tomorrow is what a human
approved today.

Staged promotion still captures most of the value: the system can establish a new *lesson*
within a day of a failure (behavioural, scoped, confidence-weighted, reversible), and can
originate future tools and skills as proposals with the evidence already attached.

A tool proposal is never promoted automatically even by a human `promote` command — it
prints the contract and asks for a typed handler and gates, because that is what a tool is.
