---
id: rule/read-what-you-started
statement: >
  A run may not report on a background command it never read. It blocks once when the answer
  claims a build, a test suite or a server did something, and no command_output call was made
  for the job that was supposed to do it.
strength: gate
scope: [verify, deliver]
enforced_by: gates.backgroundRead
on_violation: block_and_reshape
version: 1
history:
  - "v1 gate: added with background commands. Starting one returns immediately and successfully, which reads exactly like the work having succeeded — the tool result says 'started', the next step sees a call that did not fail, and the answer says the tests pass. Nothing about the shape of a start distinguishes it from a finish."
---

# Starting is not finishing

`run_command` with `background: true` returns in a few milliseconds with an id. The call
succeeded. Nothing went wrong. And nothing has happened yet.

This is a worse trap than an ordinary failure, because a failure is visible. Here the tool
result is a success, the observation list records a call that did not fail, and the only
thing separating "I started the test suite" from "the tests pass" is a `command_output` call
that is easy to forget and impossible to fake afterwards.

## What the gate checks

The answer makes a claim about something that was run in the background, and no
`command_output` was called for that job. That is the whole check. It does not require the
job to have *finished* — "the suite is still running after four minutes" is an honest
sentence, and it can only be written by someone who looked.

## What to do instead

Read it. If it has not finished, say so and say what you saw. If you needed the result and
it never arrived, that is a real answer: name the id, say how long you waited, and say what
you would conclude either way.

## Stopping

A server you started stays running. Nothing reaps it but the end of the process, and until
then it holds its port. Call `stop_command` when you are done with it — a background job
still running at the end of a run that never mentions it is the same failure wearing
different clothes.
