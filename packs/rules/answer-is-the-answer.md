---
id: rule/answer-is-the-answer
statement: >
  Delivered text may not open with narration about correcting a previous draft — "you're
  right", "let me verify", "now I can deliver the corrected answer" — followed by a
  horizontal rule and the real answer. It blocks once and asks for only the text meant to
  be read.
strength: gate
scope: [verify, deliver]
enforced_by: gates.answerIsTheAnswer
on_violation: block_and_reshape
version: 1
history:
  - "v1 gate: after a review verdict of FAIL, the retry prompt says to fix the problems and produce the final answer. A capable model sometimes complies by narrating the fix — \"You're right, let me verify my tool list... Now I can deliver the corrected answer: ---\" — and the whole turn, reasoning included, becomes the draft. Review can still pass it, because the real answer is in there somewhere. It shipped verbatim: a full paragraph of self-correction, a full system tool list, then the actual reply."
---

# The delivered text is read by a person, not kept as a record

Nothing about the review-and-retry loop tells the model that its next reply *is* the
answer rather than a description of how the answer was produced. Asked to "address the
problems and produce the final answer," a model that wants to be transparent shows its
work — and the loop takes whatever comes back and delivers it whole.

## Why this survives ordinary prompting

The model cannot see the failure from where it stands. It was asked to fix something and
explain the fix; explaining the fix is exactly what it did. The mistake is not in its
reasoning, it is in an assumption nobody stated: that "your next message" and "what the
person sees" are the same string. Telling it once, in the retry prompt, is guidance — see
`rule/ask-before-you-finish` for the precedent that guidance reaching the model does not
reliably change behaviour, which is why this is a gate rather than a sentence added to a
prompt.

## What the gate checks

A self-referential correction phrase — "you're right", "let me verify", "now I can
deliver the corrected answer" and similar — appearing before a line that is nothing but a
markdown horizontal rule (`---`), with enough real content after that rule to be an
answer rather than a stray divider. Narrow on purpose: it matches the shape that actually
shipped, not "the answer mentions checking something," which would fire on ordinary prose
about verification.

## What it does not require

It does not forbid a horizontal rule in a real answer, and it does not forbid the model
from explaining its reasoning *when that reasoning is what was asked for*. It fires only
on the specific pattern of self-narration before a divider before the real content — the
shape of an answer that was written for two audiences and delivered to the wrong one.
