---
id: rule/finish-what-you-listed
statement: >
  A run that wrote itself a task list may not deliver with tasks still open. It blocks once
  and requires each remaining task either to be finished, or to be marked dropped with a
  reason that the answer then states.
strength: gate
scope: [verify, deliver]
enforced_by: gates.tasksFinished
on_violation: block_and_reshape
version: 1
history:
  - "v1 gate: added with plan_tasks. The failure it catches is the confident partial answer — six things asked for, four done, reported as though it were six. Every other check compares the answer against what the tools did, and a step that was never attempted produces no tool calls to compare against. Only the plan knows it was missing."
---

# Four of six is not six

The list is written at the start, when the request is still whole. By the last step it has
been through several rounds of summarising, and the parts that took no effort are the parts
most likely to have thinned out of the context entirely. Nothing about that feels like
forgetting — the answer reads as complete, because everything *in* it is true.

That is why this gate compares against the plan rather than against the observations. A
piece of work that was never attempted leaves no trace in the tool record: no failure, no
error, no gap. The only artefact of it is the line the run wrote about intending to do it.

## Dropping is allowed

Abandoning a task is a legitimate outcome and often the right one — it turned out to be
unnecessary, it needed access you do not have, the first two tasks answered it. Mark it
`dropped` with the reason. The gate accepts that immediately, and the reason is what belongs
in the answer: "I did not check the staging config, because there is no credential for it
here" is worth more to the reader than silence.

## What it does not do

It does not require a plan. Most requests are one question with one answer, and
`plan_tasks` should not be called for them — a list of one item is overhead. This only
applies to a run that decided the work had parts and wrote them down.
