---
id: rule/no-imaginary-files
statement: >
  An answer may not say a file is ready, attached, saved or downloadable when no file was
  written in the run. It blocks once and forces the answer either to write the file or to
  say plainly that the content is in the answer and nothing was saved.
strength: gate
scope: [verify, deliver]
enforced_by: gates.fileReallyExists
on_violation: block_and_reshape
version: 1
history:
  - "v1 gate: added after a research run built a fundraising strategy, returned three JSON objects from the sandbox, and closed with 'three detailed strategy artifacts are ready for download'. The active skill has no write_file, so no file could have been written; the reader went looking for a document that was never going to exist."
---

# An artifact is not a file

The two words are close enough to swap without noticing, and they mean entirely different
things to the person reading the answer.

An **artifact** is evidence. It lives inside the run record, it is what a citation points
at, and its whole job is to make a claim checkable. A **file** is a thing on disk with a
path, which someone can open, attach to an email, or put in a deck.

An agent that has just computed a structured result in the sandbox has an artifact. It is
genuinely pleased with it, it is genuinely useful, and describing it as "ready for
download" is genuinely false. Nobody involved is lying: the model has produced something
real and reached for the ordinary English word for produced things.

## What the gate checks

Three things must hold before it blocks: the answer promises a file in so many words, no
`write_file` or `apply_patch` succeeded in the run, and the sentence is not already a
disclaimer. An answer that says "no file was written, the content is below" passes, because
that is the sentence the gate is trying to produce.

## Why it cannot be left to the prompt

The skill that produced the false claim had no `write_file` in its allowlist. It could not
have written a file however much it wanted to, and it still said one was waiting — which is
the tell that this is not a knowledge problem. The agent is not tracking which of its
outputs left the process. Something that *is* tracking that has to do the checking, and the
observation list is exactly that.

## What it does not require

It does not require the agent to write files. Most runs should not. "The strategy is below;
nothing was saved to disk" is a complete and honest close, and it is one sentence away from
the answer that gets blocked.
