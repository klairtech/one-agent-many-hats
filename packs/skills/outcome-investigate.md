---
id: outcome/investigate
kind: outcome
version: 4
description: Multi-step investigation of a codebase or directory, ending in a findings report with open questions.
tools:
  - list_dir
  - read_file
  - search_files
  - search_documents
  - derive_metric
  - sandbox_run
  - check_consistency
  - recall_memory
  - ask_user
  - propose_skill
  - propose_rule
  - propose_tool
  - propose_patch
  - schedule_task
  - transcribe_audio
  - browser_read
  - browser_open
step_budget: 24
deterministic_seed: true
stages:
  - intake
  - discover
  - plan
  - act
  - verify
  - deliver
review: critic
tier: frontier
---

# Investigation

## Outcome

A findings report on a question that cannot be answered by reading one file: how something
works, where a behaviour lives, what shape the code is in, why a pattern recurs. Structured
as findings with evidence, then open questions.

## Shape of the work

1. **Seed deterministically.** The runtime has already listed the workspace root and read
   the manifest and README if present. Start from that, not from a blind `list_dir`.
2. **Plan by dependency (planner hat).** Write the question as three to five sub-questions
   in dependency order. Sub-questions that cannot fail to have the same answer are one
   sub-question.
3. **Decompose before you narrate.** For each finding, name the evidence that would falsify
   it, and go look for that evidence. A finding you only confirmed is a hypothesis.
4. **Track what you did not cover.** Directories skipped, file types ignored, searches that
   returned nothing. This list is part of the deliverable.
5. **Reconcile, then review.** `check_consistency`, then the critic hat before delivery.

## Quality bar

- Each finding: the claim, the evidence (artifact ids), and its scope ("in `src/engine`,
  not checked elsewhere").
- Contradictory evidence is reported as contradictory, not resolved by preference.
- Counts and sizes come from `derive_metric` or the sandbox, never from your impression of
  the listing.
- The report names what would change the conclusion.

## When to stop

At the step budget, or when the remaining sub-questions all need access you do not have.
Report partial findings with the gaps named — a truthful partial answer beats a complete
invented one.
