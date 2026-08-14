# Contributing

Suggestions and pull requests are welcome. `main` is protected — everything lands through a
pull request, including changes from the maintainers.

## Suggesting something

Open an issue. A suggestion that says what you were doing, what happened, and what you
expected is worth more than a feature title. If you are unsure whether something is a bug or
a design choice, ask — several of the sharper edges here are deliberate and documented as
such, and if the reasoning is not obvious that is itself a bug in the writing.

## Sending a change

1. Fork, branch, commit.
2. `npm test` must pass. There are no exceptions to this, including for changes that
   "obviously" cannot break anything.
3. Open a pull request explaining what changed and why.

Commit messages are short and plain: one imperative line, a body only when the reason is
not obvious from the diff.

## What gets merged easily

- A failing test that demonstrates a bug, with or without the fix.
- A fix with a test that would have caught it.
- Documentation that corrects something inaccurate.

## What needs a conversation first

Anything that widens what the agent can do without a human saying so. The boundaries here —
the executor's checks, the path guard, the network guard, the profile rules, the grant
scopes — are the point of the project rather than an obstacle in it. A change that loosens
one is not automatically wrong, but it needs its argument written down before its code.

## Running it

```bash
./start.sh          # build and open the control panel
npm test            # the whole suite, no network needed
```

Node 20.11 or newer. There are no runtime dependencies and adding one is a decision, not a
detail.
