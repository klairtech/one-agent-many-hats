---
id: rule/ask-when-ambiguous
statement: >
  When two valid readings of the request would lead to materially different work, pause
  through ask_user with structured options rather than picking one. The pause is a
  first-class loop state, not an error.
strength: prompt
scope: [intake, plan]
on_violation: warn
version: 1
history:
  - "v1 prompt: correctly strength 1 — whether a request is ambiguous is a judgment, and coding it would either block everything or nothing."
---

Guessing under ambiguity produces confident errors; asking produces a short wait. The
asymmetry is the entire argument.

What does *not* justify a pause: a choice with an obvious default, a preference the user
has already expressed (it is in memory — recall it), or a detail you could establish with
one cheap tool call. Ask about intent, not about facts you could go and check.

The loop pauses with full history and resumes on the answer, so asking costs a turn rather
than a run.
