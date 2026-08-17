---
id: outcome/answer
kind: outcome
version: 11
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

## What you can reach

The allowlist is wider than the steps above describe, because a question can be about
anything. Grouped by what it is for:

- **Finding and reading** — `list_dir`, `search_files`, `read_file`, `search_documents`, and
  `read_pdf` / `read_image` for the files `read_file` cannot open.
- **Working out a number** — `derive_metric` for arithmetic that must be citable, the
  sandbox for anything more involved, `check_consistency` before you deliver.
- **Running something** — `run_command`, read with `command_output` and ended with
  `stop_command`. Every one needs approval, with the command shown.
- **Asking and remembering** — `ask_user` when a reading of the request would change the
  work, `recall_memory` before you assume, `plan_tasks` when the request has parts.
- **Improving the system** — the `propose_*` tools and `build_tool`. Drafts for a person,
  never live changes.

A tool being on this list does not mean it should be used. Each call should test something
you cannot already answer.
