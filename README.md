# Hats

**What if an agent's personality, its guardrails and its abilities were just files you could read?**

Not a prompt somebody buried in a Python file. Files. On your disk. With version
numbers.

---

## Where this came from

At [Klair](https://klairtech.com) we build AI automation that companies own. Our main
product, **Insighter**, is an agent that reads your warehouse and your documents and then
actually does something with them, inside authority limits a human set.

Building that forced a question I had been avoiding: what *is* an agent, structurally? The
industry answer is "several of them" — a planner agent, a critic agent, a coder agent,
passing messages. I tried that. It did not hold. Coordination cost grew faster than
capability, and when an answer came out wrong, finding out which agent decided what meant
reading an unauditable message trail.

I wrote up what replaced it as a working paper,
[*One Agent, Many Hats*](https://sandeepkavety.com/writing/one-agent-many-hats). **Klair
Labs** is where we build the small thing that proves an idea before it becomes a product.
This is the paper, as something you can run on your laptop tonight.

Sandeep Kavety,
[LinkedIn](https://www.linkedin.com/in/sandeepkavety/)

---

## So what is it

One agent. One conversation. One audit trail. It changes hats instead of spawning
colleagues.

What it is at any moment is composed, per step, out of three kinds of file:

**Skills** are playbooks. How to investigate, how to answer, how to make a change. Also the
hats: planner, guardian, critic, coder, communicator, reflector. Markdown with a header the
runtime enforces and prose the model reads.

**Rules** are guardrails that declare their own strength. Some are instructions. Some are
coded checks that block. Some are boundaries that were true before the model woke up.

**Tools** are the only way it can affect anything at all. Thirty-four ship with it, plus
whatever you connect over MCP.

Change how it behaves by editing a markdown file. No redeploy, no code.

### The hats are not other agents

The critic is not a second model with its own memory and agenda. It is the same agent,
handed a different playbook for one step, which it puts down afterwards. There is nothing
to reconcile, nothing to coordinate, and one timeline to read when something goes wrong.

Which hat goes on is decided by code, not by the model choosing a personality. That matters
more than it sounds. Early on, a run asked how many **TypeScript** files were in `src`. The
word contains "script", the coder's trigger list contained "script", so on went the coder's
hat — and because the coder is allowed only sandbox tools, the run lost `list_dir` on step
one and never recovered. Triggers match whole words now, and a hat chosen by keyword is no
longer permitted to take tools away. Only a hat the code deliberately put on can narrow what
the agent can reach.

### Somebody checks the work

**The guardian assumes you are wrong and goes looking.** It runs before delivery when the
skill asks for it, with one job: find the fabrication, the claim wider than its evidence,
the tool that failed while the draft carried on regardless.

It works. In a real run it caught the model asserting something a comment in a file did not
actually support, sent it back, and the corrected answer passed on the second pass. That
round trip only happens because of a bug I had to fix first: the failing verdict was sticky,
so the corrected draft was being judged by the old FAIL forever. A gate that can never be
satisfied is not a gate, it is a wall.

**Numbers are reconciled against evidence, not vibes.** Every number, path and quoted line
in an answer is resolved against the artifacts the run actually produced. Unreconciled
values block delivery once, force a correction, and if they survive that they ship with the
gap stated rather than quietly. It is a heuristic and both its failure modes are written
down in the rule itself.

**Every blocked action names the rule that blocked it.** A refusal you cannot trace is a
refusal you cannot argue with.

### It only acts through tools, and you decide which

Three profiles. **Read-only** is the default: it reads, searches, computes, remembers. The
worst thing a confused or manipulated model can do is give you a wrong answer that shows its
work. **Assisted** adds writing files and running commands, each one shown to you with its
diff at the moment it runs. **Trusted** pre-grants that for the session, and still writes
every call to the audit log before it executes.

Reaching the internet is a **separate** switch, off by default, because "let it edit my
files" and "let it phone anywhere" are different sizes of mistake and bundling them into one
toggle would be the worst usability-for-safety trade available.

None of this is a prompt. The profile cannot be changed by a tool, a skill, a lesson, or a
sentence in a file it reads. There is no setter.

### It writes code, in a box

When no named tool fits, it writes a snippet and runs it — in a separate process started
with `--permission`, inside a fresh VM realm whose only inputs are JSON copies of artifacts
the run already holds, with the network globals deleted before any generated code exists.

I did not want to assert that, so I measured it. `require` is undefined. `process` is
undefined. `fetch` is undefined. The classic escape, `this.constructor.constructor('return
process')()`, comes back with *"Code generation from strings disallowed for this context"*.
An infinite loop dies on the wall clock. Those probes are in the test suite, so if any of it
stops being true, the build says so.

It is defence in depth against a model writing something reckless. It is **not** a container,
and the ADR says that at the point of use rather than in a footnote.

### It reads what is not text

`read_file` returns numbered lines, and a PDF has none — so it refused, and refusing was the
whole answer. A workspace with a report in it held nothing.

`read_pdf` pulls the text out here, with no dependency and no model involved. That turned out
to be a lesson in half-working: my first version returned kilobytes of font tables as though
they were the document, and on a PDF written by a word processor it returned mojibake. Both
are worse than an error, because both are *quotable* — the model cites it and the reader
cannot tell it from the file.

The cause was mine. A subset font numbers its glyphs from zero for its own use, so code 3 is
`a` in one font and `%` in the next, and I was merging every font's table in the file into
one dictionary. The last font loaded decoded everybody's text. It walks the object graph now
and applies each font's own table as the page switches fonts, which turned
`PPPPeriodc fmfarPPeriodrec` back into `WORKING PAPER One Agent, Many Hats`. When the result
still does not read as language it says so and returns nothing, because a garbled quotation
is worse than a gap.

`read_image` hands the pixels to the model, so it works on a model that can see and honestly
reports only the file's shape on one that cannot.

### Work that takes longer than a step

`run_command` waited, capped at ten minutes, and a command that hit the cap returned
`TIMEOUT` with nothing — the work had happened and every line it printed was thrown away. No
test suite, no build, no dev server you could point a browser at.

It can start one in the background now and read it as it goes, and it kills the whole process
group when it stops one, because `npm run dev` is npm forking node and killing npm leaves
node holding the port.

The interesting part is the failure this creates. Starting a background command **succeeds**,
in milliseconds. From inside the loop, "I started the test suite" and "the tests pass" are
the same shape: a tool call that did not fail. Every other check in this codebase compares
the answer against what the tools *did*, and here that is not enough — so a gate blocks an
answer that talks about a build or a suite when nothing ever read the job. It does not
require the job to have finished. "Still running after four minutes" is an honest sentence,
and only someone who looked can write it.

### It writes down what it is going to do

Ask for six things and get four, reported as though it were six. Nobody is lying — everything
in the answer is true, and by the last step the earlier parts have been through several
rounds of summarising.

That one cannot be caught by looking at tool results, because **a piece of work that was
never attempted leaves no failure behind**. No error, no gap, nothing to notice. The only
artefact of it is the line the run wrote about intending to do it. So it writes the list down
with `plan_tasks`, and a gate refuses delivery while anything on it is still open. Dropping a
task is allowed and needs a reason — "I did not check the staging config, there is no
credential for it here" is worth more to you than silence — and the reason goes in the answer.

### It remembers, and it changes

**Takeaways** are what past runs concluded. Mark an answer wrong and it never comes back.
Correct it and it comes back corrected. Feedback rewrites retrieval; it is not a rating you
file somewhere.

**Lessons** are what it learned from going wrong. They start as drafts, get injected into
half of runs while they prove themselves, and are disabled when contradicted rather than
argued with. After a run where it drew a conclusion from a line it had not read closely
enough, it wrote itself: *"Check the specific file and line mentioned by the tool."* Nobody
prompted that.

A lesson may change **how** it works. It may never change **what it may touch**. One that
tries to widen access is refused when it is written, not politely ignored when it is read —
because a store that contains the sentence is one refactor away from obeying it.

**Workspace context** is the layer you write yourself, and it outranks everything the system
infers about you. Where you have said who you are, it listens instead of guessing.

### It can read the whole workspace, not just the file you named

`./start.sh index` walks the workspace, splits it on structure rather than on a character
count, and builds a searchable index. Splitting on structure is the part that matters:
chunk a document every 1,400 characters and you get passages whose subject is in the
previous chunk. This splits on headings, then paragraphs, then sentences, and every passage
arrives carrying the headings it sat under. 118 files, 717 passages, half a second.

Retrieval is **two rankers fused**. Keyword search finds the exact identifier, the error
string, the flag you typed verbatim — the things embeddings are famously mediocre at.
Vectors find the paraphrase. Reciprocal rank fusion combines them without pretending their
scores are comparable, and each result tells the agent which ranker found it.

Set an embedding model and it is real semantic search. With no embedding model it still
works, but it is keyword matching, and **it says so in every single result** rather than
implying an understanding it does not have.

```bash
ollama pull nomic-embed-text
./start.sh config set providers.ollama.embedModel nomic-embed-text
./start.sh index
```

Rebuilds are incremental — unchanged files keep their vectors, because re-embedding a
repository every time one file moves is how people end up never rebuilding.

There is no vector database. A workspace is a few thousand passages, cosine over that is
milliseconds, and a service to run would be a service to run.

### You can see what it produced, and what it has cost you

Answers render as markdown rather than as a wall of text, with artifact citations as chips
you can spot. The **Files** tab is the same workspace the agent sees, through the same path
guard: images, PDFs and text preview inline, markdown renders, HTML opens in a sandboxed
frame with scripts off and no access to the page around it, and anything can be opened full
screen or revealed in Finder. Word, PowerPoint and Excel files are declined honestly —
rendering those properly needs a real library, and a rough approximation is worse than
saying "open it in the app that owns it".

**Analytics** is computed from the run records already on your disk. Nothing is collected
and nothing is sent; this is hats reading its own files. Completion rate, steps per run,
which gates fired and how often they stopped something, which boundaries refused something
and why, tools by usage and denial, tokens, and spend. Tokens are always counted; money is
only shown where a model matches a price, and runs that could not be priced are named
rather than folded in as free.

The number worth watching is **cost per completed outcome** — the paper argues that is one
of the three measurements that would settle its central claim, so it is on the page rather
than in a footnote.

**Storage** shows what every part is costing you in megabytes and, more importantly, what
deleting it costs you. Run records are the largest thing here and also the trail that makes
a wrong answer diagnosable, so they are labelled a permanent loss rather than a tidy-up.
The index is rebuildable, the cache is free, artifacts lose evidence but keep the trail.
Workspaces whose folder no longer exists are flagged, since those are the safe ones to
clear. On the command line it is `hats space`, and it is a dry run until you add `--yes`.

### It proposes; you promote

When the same gap keeps appearing, it drafts a skill, a rule or a tool — into a proposals
folder, never into the live registry. There is no tool that writes a live skill. Not a
restricted one, not an admin one.

You can loosen that, one rung at a time. On `adaptive`, a skill or rule that has recurred
three times promotes itself, versioned and announced. On `self-healing`, a fix to a tool
that already exists applies once the build and the entire test suite pass, and reverts on
either failure.

Watching a 7B do this was the useful part. It proposed both a skill and a tool, and its
skill had a malformed header — so promotion refused it with a line number instead of
writing a broken playbook into the registry. Proposals are parsed before they are promoted,
which is the difference between a system that grows and a system that corrupts itself.

### It can write a tool, and the tool cannot lie about what it does

For a long time the top rung was "a tool never auto-promotes at any setting", and the
reason sounded solid: a skill rearranges abilities you already granted, a tool is a new
ability, and a model proposing one while the same model approves it is not a control.

Then someone asked an ordinary question — how many rows are in the orders table — about
data that lived behind an API. It read the docs, worked out it needed a connector,
collected the credentials, and stopped, because there was nowhere to go. It could describe
the tool it needed in precise detail and could not build it. That is not an agent that
extends itself; it is an agent that files tickets.

The objection was never really about tools. It was about *declarations nothing checked*: a
tool's spec claims `mutating: false`, and the executor believes it. So invert it. On
`self-extending`, `build_tool` writes a real handler and declares its own powers, and those
declarations become the flags its process is started with. A tool that says
`mutating: false` is spawned without `--allow-fs-write`, and Node refuses the write no
matter what the code attempts. The declaration cannot be a lie, because the declaration is
what builds the jail.

There is no clever static analysis of the generated source, deliberately —
`globalThis['fe'+'tch']` defeats any regex, and a check that can be evaded is worse than
none because it reads as protection.

A built tool has three possible homes, and they are not interchangeable. **Conversation**
means it works now and is gone when the run ends, so a one-off exploration leaves nothing
behind. **Device** is `~/.hats/tools`, outside any repository, which is right for a connector
wired to your own account — nobody else could use it anyway. **Workspace** writes it into a
`hats-tools` folder inside the project, where it can be committed and arrives already working
for whoever clones next; that is the right home when the tool is part of how *this project*
works rather than how *this person* works. The question to ask is whose tool it is. A parser
for one repository's log format belongs to the repository.

Where it lives decides who else gets it and nothing else — the flags its process starts with
come from its manifest either way. A workspace tool beats a device tool of the same name,
because the alternative means a tool committed to a repository behaving differently depending
on what each person happened to build first. Neither can take a built-in's name.

The honest edge: `network: true` is a real widening, and it is what a connector needs by
definition. It is visible in the manifest, in the Tools tab, and in the audit log.
`minProfile` is self-declared and no flag enforces it, so a tool that declares `read-only`
on something that should have needed approval skips a prompt — bounded by the fact that the
filesystem grant is still the workspace and nothing else.

### It can fix a playbook, not just add another one

It could always write a *new* skill or rule. Revising one needed something it did not have:
the current text. So the only way to improve a playbook that was nearly right was to write
a second one from memory, and two overlapping playbooks make routing come out differently
run to run.

Now it reads the live text and edits that, keeping the id. A revision lands on first
sighting rather than waiting to recur three times — the recurrence bar asks whether
something new is worth adding, which is the wrong question for a fix to something that
already exists and is already wrong. The replaced version is kept, so a bad revision is one
command away from being undone.

A rule revision has one limit. It may sharpen what the rule says, narrow its scope, record
what it learned. It may not lower `strength`, repoint `enforced_by`, or downgrade blocking
to warning — each of those removes the check while leaving text that still reads like a
rule, and each is refused. Promotion up the ladder, `prompt → gate → code`, is allowed.

Worth knowing what this adds up to: at `self-extending` a run can revise a live rule with
no human in the loop. The boundary cannot be dismantled, but its *wording* can drift over
many runs, each step looking reasonable on its own. `hats registry` shows what changed and
every version is on disk. Glance at it occasionally rather than never.

### Any model, including the ones on your own machine

Ollama and other local servers, Claude, OpenAI, Gemini, DeepSeek, Qwen, Kimi, GLM, Groq,
OpenRouter, Mistral, xAI, LM Studio, vLLM. Three wire formats cover almost all of it, so
adding a vendor is a table entry rather than code.

Models without tool calling still work. It notices the rejection, moves the tool catalogue
into the prompt, parses what comes back, and tells you the run was degraded. That is what
makes a 4B model on a laptop usable instead of merely present.

Steps are bound to a **tier** — light, standard, frontier — not to a model. Judgement work
goes up, extraction stays cheap, and when the context gets tight it downgrades on purpose.
One model in all three slots is a perfectly good answer.

### You can manage the models from the same page

What is installed, how big it is, and a button to remove it. Install by typing any name,
with a real progress bar because Ollama streams the pull. There is a shortlist to start
from, chosen mostly for whether a model reliably emits tool calls — which matters more here
than any benchmark, since a model that cannot will fall back to the text protocol and be
worse at everything.

It is a shortlist and it says so. **Ollama does not publish a search API for its own
library**, and scraping the website would break the first time they rename a CSS class, so
I did not pretend otherwise. Hugging Face *does* publish one, so you can search GGUF models
there and install straight from it — that is an outbound request to a third party, so it
sits behind the same network switch as everything else that leaves your machine.

### It uses other people's tools

Any MCP server's tools become ordinary tools here, named `mcp__server__tool`, going through
the same executor and the same approval as everything built in. A tool the server does not
mark read-only is treated as able to change things, because the annotation is written by the
same party whose behaviour it describes.

**You can sign in to one.** For a long time a connector could carry a static header and
nothing else, which quietly excluded almost everything worth connecting — issues, documents,
error reports all authenticate the other way. It speaks OAuth now: press **Sign in** and it
finds the provider from the 401, registers itself, and sends you there to approve.

The property that matters is that no password comes near this process. The browser goes to
your provider; this process learns an authorization code, which is worthless without a
verifier it never sent anywhere. PKCE is S256 and a provider that offers only the weaker
method is **refused rather than downgraded** — the code comes back over a loopback redirect
that any local process could race for, and the verifier is the only thing that makes winning
that race useless. The `state` is checked before the code is read. Tokens land in
`credentials.json` at 0600, one key per connector, and removing a connector deletes its
token with it.

The connectors page carries a short list that was **checked from this machine** rather than
remembered: Linear, Notion, Sentry, Asana and Jira/Confluence for the sign-in kind, Context7,
Playwright and the protocol's own reference server for the local kind. Every entry names what
it adds, what it costs you, and what was actually observed. Nothing is preloaded or connected
— adding one is a click you make, because an MCP server is someone else's code running on
your machine. Two that work and are deliberately absent say why on the page: GitHub, which
has no dynamic client registration and so needs a client id you create by hand, and PayPal,
which works and moves money.

I did not implement sampling. A server that can ask the model to generate is a server that
can steer your agent, and that is exactly the authority this whole design keeps out of
things it merely read. What connecting a server does and does not change is written out in
[`rule/mcp-servers-are-third-party`](packs/rules/mcp-servers-are-third-party.md) — worth
reading before you connect one, because the network guard governs *our* tools and cannot
govern a process we did not write.

### The panel keeps your place

Every view used to be rebuilt from the server when you opened it, so leaving a page and
coming back threw away the conversation you were in the middle of, the file you had opened
and where you had scrolled to. Pages are parked now rather than discarded — the DOM is moved
aside, so click handlers survive and a run streaming in the background keeps writing into
nodes that are simply off screen for a while.

Four views are the exception, and for one reason: they are what the agent runs on. A stale
registry claims a tool that is gone, a stale proposal list offers a button for something
already promoted, and a stale connector page shows a credential that was revoked. Anything
describing the agent's own capability is re-read every time; everything else is yours.

Proposals carry their action on the row — **Repair**, **Install**, **Promote** — rather than
behind a chevron that reads as a status, and a repair streams into the chat where you can
watch it and answer anything it asks.

### It can run when you are not there — carefully

You can put work on a timetable, and you can text it.

```bash
hats schedule add "summarise what changed in this repo today" --at "0 18 * * 1-5"
hats schedule daemon
```

Cron expressions, `@daily`, `@every 30m`. The panel fires them too, so if you started with
`start.sh` there is nothing else to run.

The interesting part is not the timer. Two things in this codebase are defined in terms of
a human being present — the approval prompt, and the `trusted` profile, which means
"approval pre-granted for the session". A scheduled run has no session and nobody who
granted anything, so `trusted` at 3am is not a risky setting, it is an incoherent one. It is
refused. Approval **auto-denies** and writes down the denial; there is deliberately no flag
anywhere that makes it auto-approve.

So by default a schedule reports rather than acts, and that turns out to be the useful
behaviour: it tells you what it would have done and what stopped it. When you do want it to
act, you name the tools yourself, while you are sitting there:

```bash
hats schedule add "write today's summary to notes/daily.md" --at "@daily" \
  --profile assisted --allow-tool write_file
```

That is the same human approval, moved to the moment a human is actually available to give
it. Narrow, written into the schedule, and attributable to whoever created it.

Messaging works the same way. A channel — Telegram, or a folder you drop files into — has an
explicit list of senders and no wildcard, because an empty list is the only sane default for
something that lets a remote party start an agent on your laptop. Anyone not on the list is
ignored silently; replying would only confirm the thing is listening. A message is an
unattended run too, even though a human sent it, because that human cannot see what the
agent is about to do with it.

The cost is real: it makes the most-requested use case ("every morning, just fix X") harder
to express. I would rather pay that than ship a `trusted` cron job.

---

## Try it

You need **Node 20.11 or newer**. A local [Ollama](https://ollama.com) model costs nothing
and is what I used for most of this. A key from Anthropic, OpenAI or Google works too.

```bash
./start.sh
```

That is the whole thing. It installs what it needs, builds what changed, starts your local
model server if you have one, and opens the control panel.

Everything else happens on that page. Pick a provider, paste a key if it needs one, browse
the models with **live prices per million tokens**, bind one, and start. The prices are
fetched from OpenRouter's catalogue rather than a table I typed out, because a table I typed
out would be wrong within a week.

Keys you paste go into `~/.hats/credentials.json` at mode 0600 — deliberately not into
`config.json`, which is the file people screenshot and paste into issues.

If you would rather stay in the terminal:

```bash
./start.sh --cli                    # a session
./start.sh run "what is here?"      # one shot
./start.sh doctor                   # what is configured and what is reachable
./start.sh verify anthropic         # a real round trip: key, models, chat, tool calling
```

Everything it knows lives in files under `~/.hats`. The skills it runs, the rules it obeys,
the memory it keeps, every run it has done and every tool call inside it. Read them, edit
them, delete them.

---

## Fair warning

This is a Labs experiment, not a product. It is rough in places I know about and probably
some I do not.

- **The sandbox is not a container.** It is a separate process, a permission-restricted
  runtime, a fresh realm and no network globals. That is real, and it is not a VM. If
  untrusted content could ever influence the code being generated, switch the runner to
  Docker and accept the dependency.
- **The workspace root is the only real boundary, and you pick it.** Start it in your home
  directory and your home directory is the workspace. It prints the root on every run for
  exactly this reason.
- **Only the Ollama path has been run against a live API by me.** The Claude, OpenAI and
  Gemini adapters are written from their documented wire formats and type-check, and every
  base URL answers as expected, but I had no key at build time. `hats verify` closes that
  in ten seconds and I would run it first.
- **Nothing scheduled survives a reboot.** There is no launchd or systemd integration, so
  schedules only fire while the daemon or the panel is running. Missed firings are counted
  and reported, never replayed — waking up to a week of backlogged runs would be worse than
  missing them.
- **Telegram is written from the docs, not run against a real bot.** The file-backed channel
  round-trips against a live model and is what the tests exercise. If you connect Telegram
  and it does something strange, that is where I would look first.
- **A small local model gives you a small local agent.** On a 7B, a run that should take
  three steps sometimes takes eleven. The structure bounds the damage — budgets, gates, an
  honest "I did not check that" — but it cannot supply insight the model does not have.
  Watching a 7B search for `//working paper//` four times because it wrapped a regex in
  slashes taught me more about tool descriptions than any amount of design did. It strips
  the slashes now.
- **`read_pdf` reads text, not layout.** PDF has no concept of a paragraph, only glyphs at
  coordinates, so reading order follows the order the generator wrote them — right for
  ordinary prose, unreliable for multi-column pages and tables. A scanned PDF is images of
  text and contains no text to find; it says so and returns nothing rather than a fragment.
- **`read_image` needs a model that can see.** On one that cannot, the call reports the
  file's type and size and nothing about what is in it.
- **Signing in to a connector is verified up to the point where you take over.** Five
  providers were checked from a real machine through this code — the 401, the metadata, the
  authorization server, dynamic registration, S256 — and the whole exchange runs end to end
  against a local authorization server that verifies the PKCE challenge itself. What I have
  not done is complete a sign-in at one of those five, because that needs somebody's account.
  If a real provider does something the spec did not lead me to expect, that is where it will
  surface.
- **Decisions are serial by design.** The critic and the guardian are hats on one timeline,
  so you wait for them. That is the price of being able to reconstruct what happened.
- **A tool the agent wrote is only as good as the model that wrote it.** The runtime
  guarantees what such a tool may *touch*, not that its logic is right. On a small model
  expect a few failed attempts before one compiles — the failures are visible and it
  recovers, but a connector it produces deserves a read before you rely on its numbers.
- **`self-extending` means it can change its own playbooks unattended.** A rule cannot be
  weakened and every version is kept, so nothing silently loses a guardrail. Wording still
  drifts if you never look. `hats registry` is the place to look.
- **Retrieval is keyword matching until you set an embedding model.** It is honest about
  that in every result, which is the least it can do, but a keyword miss is not evidence of
  absence. Memory retrieval is keyword-only regardless; it holds hundreds of short strings,
  and it will start missing the obvious one somewhere past a few thousand.
- **The index does not watch for changes.** Edit a file and search still returns the old
  passage until you reindex. Rebuilds are incremental and fast, but they are not automatic.
- **One instance per workspace.** Two at once will interleave their writes to the same files.
- **Interrupting a local run can wedge Ollama's model runner.** That is upstream, not here,
  but you will meet it. `kill $(pgrep -f "ollama runner")` and it respawns.

The part I would actually defend is the boundary. Every action goes through one function.
An injected instruction can change what the model says and cannot make the executor accept a
tool outside the allowlist, a path outside the workspace, a network call while egress is
off, or a change you did not approve. That is the whole design: assume the model's output
can be captured, and put the boundaries where its output is not consulted.

---

## If you want to read it rather than run it

[The working paper](https://sandeepkavety.com/writing/one-agent-many-hats) is the argument
this implements. The PDF is in the repo root too, so it travels with the code.

There are 273 tests and they run in a couple of seconds without touching the network,
because the whole engine can run against a scripted model. The sandbox isolation claims are
assertions in that suite rather than sentences in a document — the same is true of the
allowlist intersection, the path guard, the grant scopes and the unattended denials. If you
want to know whether a boundary is real, the test is the answer.

Every rule of any real strength has to name the code path that enforces it, and the registry
refuses to start if that path does not exist:

```bash
./start.sh registry enforcement
```

---

## Your stuff stays yours

Everything lives under `~/.hats` and your workspace. Nothing phones home. There is no
telemetry. Your keys never reach the model, never appear in a log, and are never returned by
the control panel — it will tell you a key is set and show you its last four characters, and
that is all it knows how to say.

---

## Want to help, or just tell me something

Fork it and open a pull request. Ideas, or you built something odd with this? Write to
**hello@klairtech.com**. I read those.

If you want the serious version of this idea, that is
[insighter.co.in](https://insighter.co.in).

Free for noncommercial use, under the
[PolyForm Noncommercial licence](LICENSE.md), with one condition: if you build on it, keep the
"Built on Klair Hats" credit visible and link back.

Using it inside a business or in something you charge for needs a commercial licence. That
is not us being difficult, just write to **hello@klairtech.com** and tell us what you have
in mind.

Take it apart.
