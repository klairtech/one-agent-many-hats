---
id: rule/sandbox-isolation
statement: >
  Generated code runs in a separate process started with --permission, inside a fresh VM
  realm whose only inputs are JSON-cloned artifact snapshots, with network globals deleted,
  under wall-clock and heap caps. No filesystem, no subprocess, no credentials, no live
  sources.
strength: code
scope: [sandbox_run]
enforced_by: sandbox.runner
on_violation: block
version: 1
history:
  - "v1 code: born at strength 3. There is no prompt-level version of this rule that would mean anything."
---

Four layers, each covering a gap the others leave — the measurements and the reasoning are
in ADR-0004.

Stated plainly, because it should not live in a footnote: this is defence in depth against
a model that writes reckless code. It is **not** a boundary of the same class as a VM or a
container. If generated code can ever be influenced by untrusted third-party content — a
fetched page, a shared skill pack — switch `sandbox.runner` to `docker` and accept the
dependency.

A successful escape still lands in a process that cannot read the disk, cannot spawn
anything, and whose network globals are gone, holding only snapshots this run was already
entitled to read.
