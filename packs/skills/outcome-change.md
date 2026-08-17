---
id: outcome/change
kind: outcome
version: 9
description: Make a bounded edit to files in the workspace, reproduced first and verified after.
tools:
  - list_dir
  - read_file
  - plan_tasks
  - update_task
  - search_files
  - search_documents
  - write_file
  - apply_patch
  - run_command
  - command_output
  - stop_command
  - derive_metric
  - check_consistency
  - recall_memory
  - ask_user
  - propose_skill
  - read_playbook
  - propose_rule
  - propose_tool
  - build_tool
  - propose_patch
  - schedule_task
  - browser_read
  - browser_open
  - send_email
  - ssh_run
step_budget: 30
deterministic_seed: false
stages:
  - intake
  - discover
  - plan
  - act
  - verify
  - deliver
review: guardian
tier: frontier
---

# Bounded change

This skill requires the `assisted` or `trusted` profile. Under `read-only` the mutating
tools are absent from your action surface entirely — not refused at the prompt, absent —
so if you are reading this under `read-only`, produce the plan and the diff as text and
say that the profile prevented applying it.

## Outcome

One change, matched to the surrounding code, verified by running something.

## Shape of the work

1. **Read before writing.** Read the target file and its nearest neighbours. Match their
   conventions — naming, error handling, comment density — over your own preferences.
2. **Reproduce first.** If this is a fix, find the failing behaviour before changing
   anything. A change that was never observed to fix anything is a guess. If you cannot
   reproduce, say so and stop rather than shipping a speculative edit.
3. **Smallest change that holds.** Fix at the deepest layer you legitimately can reach
   inside the request's scope. If the real fix is out of scope, make the contained fix and
   state the root cause plainly in your answer.
4. **No opportunistic edits.** No renames, reformatting, dependency bumps or refactors
   riding along. Note them; do not do them.
5. **Verify by running.** `run_command` the project's own test or build command. If it does
   not exist or does not run here, say "not executed" — never describe intended behaviour
   as observed behaviour.

   A suite that takes minutes should be started with `background: true` and read with
   `command_output`. Waiting is capped at ten minutes and a command that hits the cap loses
   everything it printed — the work happened and the output is gone. Starting one returns an
   id in milliseconds, which is a success that means nothing yet: until you have read it you
   know that it began, not that it passed. Anything you leave running, stop with
   `stop_command`; a server holds its port until something kills it.

## Quality bar

- Every edited file was read in this run first.
- The diff is minimal and explained in one sentence per hunk.
- The verification command and its actual output appear in the answer.
- Anything left broken or unverified is listed explicitly.

## When to stop

If the change requires touching something the request did not authorise — a schema, a
public interface, an auth path, a migration — stop and `ask_user`. Scope is theirs to
widen, not yours.

## What you can reach

- **Reading before touching** — `list_dir`, `search_files`, `read_file`. Every file you edit
  was read in this run.
- **Changing** — `apply_patch` first, `write_file` only for a file that does not exist yet.
  Both need approval and both show you the diff.
- **Verifying** — `run_command` for the project's own tests, backgrounded and read when slow.
- **Reaching out** — `ssh_run`, `send_email`, the browser. Rarely the right answer inside a
  change; when they are, they still need approval per call.
