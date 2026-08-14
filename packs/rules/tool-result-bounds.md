---
id: rule/tool-result-bounds
statement: >
  No unbounded tool result enters model context. Every result is stored whole as an
  artifact and only a shaped summary (id, shape, size, head) returns to the loop.
strength: gate
scope: []
enforced_by: executor.result_shaper
on_violation: block_and_reshape
version: 1
history:
  - "v1 prompt: 'keep results small'. A prose limit is strength 1 by definition, and the first large file read blew the window."
  - "v2 gate: shaping moved into the executor, where it holds regardless of what the model intends."
---

The paper's reason for this rule is context economy. The second reason matters more: when
payloads flow through the model, the model can launder values it invented into what looks
like evidence. Artifact references cannot be laundered — `check_consistency` resolves the
id and compares.

Shaping is not truncation-and-hope. The summary states what was dropped and how to get it
(`read_file` with a range, `sandbox_run` against the artifact), so a bounded observation is
actionable rather than merely small.
