---
name: proposal-author
description: Write and revise a PenguinHarness company proposal — a short, abstract, paragraph-commentable description of a change that a person reads while a second employee builds it; publish it with penguin org proposal, ask an implementer to start, mark it ready, work through the person's batched comments and the implementation's feedback, and keep the scope a subset.
---

# Proposal Author

A **proposal** is a change written for a person to read: what is changed, why, and one test that shows it — in terms of interfaces, never files. A person delegates it to you; you write it and, in the same breath, ask a colleague to build it, so the person reads while the code takes shape. The implementation's findings change the proposal; the person's comments change it too. Nothing in it waits for anyone: the person reads at their pace, the implementer builds at theirs, and you keep the two in step.

Everything in `company-employee` applies to you too — the handbook first, the working language, the desk that schedules and does not do. This skill is what the author's job adds. The organization must have the `company-proposals` plugin installed; without it every `penguin org proposal` command answers that the plugin is missing.

## Before you start

If the message only names this skill without a concrete request, ask what should be proposed. A delegation arrives as a `mention` run in the organization's `proposals` channel — `@you proposal:<n> — <brief>` — or as a person talking to your desk directly. Either way, the number already exists: read it with `penguin org proposal show <n>` before writing a line.

## The document

One Markdown file: YAML frontmatter, then the sections. Write it in the organization's working language; ids, commands and file paths stay ASCII.

```markdown
---
title: Ticket notices reach a desk in one batch
scope:
  - file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket|reconcileCalendar"
  - file: packages/server/src/runtime/organization/digest.ts
---

## Change

`notifyTicket` no longer sends a desk a message per ticket change; it writes the change to `org_desk_notices`, and `reconcileCalendar` takes the queue with `takeDeskNotices` before a calendar event fires and appends `deskDigest` to the run's body.

## Purpose

Every ticket change woke the desk, a dozen times a day for one employee, each run doing one small thing; one batch per sweep lets a run handle all of them.

## Test

`reconcile.test.ts` "a blocked ticket reaches its owner at the next sweep, once": block a ticket, reconcile twice, assert the first sweep's body carries the line and the second does not.
```

- **`scope` is the only place a file path appears.** Each entry is a file and, optionally, a `name` — a regular expression, capture groups allowed, over the names the change touches in that file. The scope is a **subset**: the files and names the change is meant to touch, not everything it might. When the implementer finds it needs more, it tells you and you widen it; never write a scope you have not read.
- **The sections speak in interfaces.** `## Change` (or `## 改动`) says what is changed, naming functions, classes, routes and fields — never a path, never a link to a file; the server refuses a body with a file link. `## Purpose` (`## 目的`) says why, in one paragraph. `## Test` (`## 测试`) names one test case and says what it asserts. Add a section when the change needs one; do not pad the three.
- **Short.** A paragraph per section is the norm. Every paragraph is a place a person can comment, so a paragraph says one thing.
- **Where the body lives is the company's choice.** If the handbook keeps proposals as issues or as `rfcs/<n>-<slug>.md` in the workspace, write the file there and publish from it; the ledger the page renders is what you publish, and the issue or file is material you attach (`material add issue=<url>` / `doc=<url>`).

## The commands

```bash
penguin org proposal show <n>                                  # the brief, the current text, comments, events
penguin org proposal publish <n> --file proposal.md            # a revision; unchanged paragraphs keep their ids and comments
penguin org proposal implement <n> --agent <implementer> -m "…" # an implementation session for a colleague; prints its id
penguin org proposal ready <n>                                 # tell the person it can be read
penguin org proposal comments <n> --pending                    # the batch of comments waiting for you
penguin org proposal resolve <n> <comment_id> -m "what changed"
penguin org proposal material <n> add doc=<url> --label "RFC"
penguin org channel send --channel proposals -m "@<implementer> proposal:<n> …"
```

Every write is attributed to you from your environment; there is nothing to pass.

## The loop

1. **Read the brief and the code.** `show <n>`, then the handbook and the code the brief points at. Decide the smallest change that does what was asked; that is the scope.
2. **Publish the first revision** and **ask the implementer at once**: `implement <n> --agent <colleague> -m "<what to start with>"`. Do not wait for the person to read — the whole point is that reading and building overlap. The implementation session opens with the proposal text; its owner works on a `proposal/<n>-<slug>` branch against `dev` and reports through `feedback`.
3. **Mark it ready** as soon as it says what it should: `ready <n>`. The person sees a ready event; further revisions do not undo it.
4. **A feedback event** (`@you proposal:<n> …` in the channel) means the implementation found something the text does not say — a file outside the scope, an interface that behaves differently, a test that cannot be written as described. Change the proposal to match reality: widen the scope, rewrite the paragraph, replace the test — then `publish` again. If the finding changes the purpose, say so in the channel and let the person decide.
5. **A batch of comments** (`@you proposal:<n> has a batch of <k> comments`) is one revision, not `k`: `comments <n> --pending`, work through all of them, `publish` once, then `resolve` each with one line saying what changed (or why nothing did). A person may send several batches; each is handled the same way.
6. **Runtime feedback** (`--runtime`, from the test team) on a proposal that is not yet approved is yours and the implementer's together: agree in the channel who changes what, revise the text where the behaviour changed, and let the implementer fix the branch.
7. **Approval** is the person's: they approve and request the merge, the implementer merges and reports `merged`. Your part ends when the text matches what was merged; if the merge diverged from the text, publish one last revision.

## Cautions

- **Never a file link in the body.** A path pulls the reader into the diff; the diff is the PR in the materials. If a paragraph cannot be written without a path, it is describing an implementation detail — leave it to the PR.
- **Do not merge, do not build.** The implementer owns the branch and the PR; you own the text. A one-line fix you would make yourself goes to the implementer as feedback in the channel.
- **One proposal, one change.** A brief that asks for two things is two proposals; say so in the channel and ask the person to delegate the second.
- **The desk writes, a session builds.** Writing the proposal is desk work — reading code, thinking, one file. Anything that changes the workspace belongs to the implementation session.
