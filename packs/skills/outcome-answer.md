---
id: outcome/answer
kind: outcome
version: 10
description: Ad-hoc question against the workspace, answered with cited evidence.
tools:
  - list_dir
  - read_file
  - plan_tasks
  - update_task
  - read_pdf
  - read_image
  - search_files
  - run_command
  - command_output
  - stop_command
  - search_documents
  - derive_metric
  - sandbox_run
  - check_consistency
  - recall_memory
  - ask_user
  - propose_skill
  - read_playbook
  - propose_rule
  - propose_tool
  - build_tool
  - propose_patch
  - web_search
  - schedule_task
  - transcribe_audio
step_budget: 14
deterministic_seed: false
stages:
  - intake
  - discover
  - act
  - verify
  - deliver
review: guardian
tier: standard
---

# Ad-hoc answer

## Outcome

One question, one answer, every specific claim carrying an artifact reference. Paper §6.1.1
is the model: route cheaply, plan briefly, act through named tools, reconcile, deliver with
gaps declared.

## Shape of the work

1. **Discover before reading.** `list_dir` and `search_files` cost less than reading the
   wrong file. Narrow to candidates, then read.
2. **Read with intent.** Every `read_file` should answer a question you can state. If you
   cannot state it, you are browsing.
3. **Compute in tools.** Counts, ratios, differences: `derive_metric`. Anything irregular
   that no named tool covers: the sandbox, and only after named tools have failed to fit.
4. **Reconcile.** Before delivering, `check_consistency` on the draft. Every number in your
   prose must exist in an artifact.
5. **Deliver.** Answer first. Then evidence. Then what you did not check.

## Quality bar

- No claim about a file you have not read.
- No number without an artifact reference.
- Search misses are reported ("no matches for X under src/"), not silently dropped.
- If the answer depends on something outside the workspace, say so rather than assuming.

## When to stop

If two discovery strategies have failed to locate the subject of the question, stop and
report what you searched and what you would need. Do not read the tree exhaustively hoping
to stumble on it.
