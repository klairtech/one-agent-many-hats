---
id: rule/ask-before-you-finish
statement: >
  An answer may not ask the human for connection details — a key, a password, a region, an
  endpoint, a login — when ask_user was available all run and was never called. It blocks
  once and forces the question to be asked as a form, while the run can still use the reply.
strength: gate
scope: [verify, deliver]
enforced_by: gates.clarificationAsked
on_violation: block_and_reshape
version: 1
history:
  - "v1 gate: added after a run correctly worked out it needed AWS credentials and said so in its final paragraph, ending the run and making the person start over. Prompt guidance did not fix it; the realisation arrives while the agent is composing prose, not while it is choosing a tool."
---

# Ask while you can still use the answer

An agent that works out it needs a credential has done the hard part. What it does next
decides whether that insight is worth anything.

Asked in the final answer, it is worth nothing. The run is over. The person reads a
paragraph, works out which values are wanted, guesses at the format, and starts again from
the beginning — and the agent that eventually gets the key has forgotten everything the
first run discovered. Asked through `ask_user` with `fields`, it is a labelled form, a
pause, and an answer that continues with the values in hand.

The gap is not knowledge. It is timing, and timing is not something prompting fixes
reliably, because the need for a credential becomes obvious at exactly the moment the agent
has stopped calling tools and started writing conclusions. By then the shape of the work is
prose, and a request for input reads like a natural closing sentence rather than a missed
tool call.

So the check runs where conclusions are checked. Three things must all hold before it
blocks: the draft asks the human to provide something, the something is connection
vocabulary rather than ordinary English, and `ask_user` was in the allowlist and never
called. An agent that asked and was refused is reporting a fact. An agent that had no such
tool is describing a limit. Neither is blocked.

## What it does not require

It does not require the agent to obtain access. "I asked, they declined, here is what I
could establish without it" is a complete answer, and so is "no tool in my list can open an
Athena connection — `athena_query` would" after the form has been filled in. The rule is
about asking at the moment the answer is still usable, not about succeeding.
