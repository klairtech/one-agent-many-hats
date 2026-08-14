---
id: rule/mutation-requires-approval
statement: >
  Under the assisted profile every mutating tool call is presented to the human with its
  full diff or command line and executes only on an explicit yes. Under trusted, approval
  is pre-granted for the session but every call is still diffed into the audit log before
  execution. Under read-only, mutating tools are absent from the surface entirely.
strength: gate
scope: [write_file, apply_patch, run_command]
enforced_by: executor.approval
on_violation: block
version: 1
history:
  - "v1 gate: born as a gate, at the executor, because approval enforced anywhere else is a suggestion."
---

Absent, not refused. Under `read-only` the mutating tools are not in the schema list the
model receives, so the model does not spend steps proposing calls it cannot make. If it
invents one anyway, the executor rejects it against the registry — two independent reasons
it fails.

The audit entry is written **before** execution, not after. A command that hangs, crashes
the process or destroys its own evidence still leaves a record of what was about to run.
