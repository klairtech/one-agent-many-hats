---
id: rule/workspace-scope
statement: >
  Every path the agent reads or writes resolves inside the active workspace root or
  $HATS_HOME. Symlinks are resolved before the check. There is no tool, skill, lesson or
  user instruction that widens this at run time.
strength: code
scope: []
enforced_by: core.PathGuard
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3. This is the local analogue of the paper's tenant boundary; nothing weaker is defensible on a machine with the user's files on it."
---

The paper enforces tenancy with per-tenant credentials at the data layer. A laptop has no
data layer and no credential boundary, so the strongest available boundary is the
filesystem one, held in `src/core/paths.ts`.

Strength-3 rules are one line of statement and a pointer to the enforcement, because their
entire content *is* the enforcement. There is nothing here for a model to comply with.

Known residual: the workspace root is chosen by the user at launch. Launching in `~` makes
the whole home directory the workspace. The CLI prints the resolved root on every run for
exactly this reason.
