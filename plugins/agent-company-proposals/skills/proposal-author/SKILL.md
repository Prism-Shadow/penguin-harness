---
name: proposal-author
description: Write and revise a PenguinHarness company proposal — a short, abstract description of a change that a person reads — and comments on, passage by passage — while it is being built; start one yourself or take a delegation, publish it with penguin org proposal, open the implementation session (your own, or a colleague's), mark it ready, work through the person's batched comments and the implementation's feedback, and keep the scope a subset.
---

# Proposal Author

A **proposal** is a change written for a person to read: what is changed, why, and one test that shows it — in terms of interfaces, never files. It is a task mechanism, not a job: any employee proposes — on a person's delegation, or on its own when a change needs the board's eyes (the CEO proposing a plan is the plain case) — and you write it and, in the same breath, open the implementation session, so the person reads while the code takes shape. You build it yourself unless a colleague is better placed. The implementation's findings change the proposal; the person's comments change it too. Nothing in it waits for anyone: the person reads at their pace, the build goes at its own, and you keep the two in step. Approving, rejecting and commenting stay with people.

Everything in `company-employee` applies to you too — the handbook first, the working language, the desk that schedules and does not do. This skill is what writing a proposal adds; it arrives on your Agent by itself the first time you write or build one. The organization must have the `company-proposals` plugin installed; without it every `penguin org proposal` command answers that the plugin is missing.

## Before you start

If the message only names this skill without a concrete request, ask what should be proposed. A delegation arrives as a `mention` run in the organization's `proposals` channel — `@you proposal:<n> — <brief>` — or as a person talking to your desk directly; then the number already exists: read it with `penguin org proposal show <n>` before writing a line. A proposal of your own starts with `penguin org proposal create --brief "<one sentence>"` — you are its author; name `--author <colleague>` only to hand it to someone else.

## The document

One Markdown file: YAML frontmatter, then the sections. Write it in the organization's working language; ids, commands and file paths stay ASCII.

```markdown
---
title: Ticket notices reach a desk in one batch
root: penguin-harness
scope:
  - kind: edit
    file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket|reconcileCalendar"
  - kind: new
    file: packages/server/src/runtime/organization/digest.ts
  - kind: rename
    from: packages/server/src/runtime/organization/notices.ts
    file: packages/server/src/runtime/organization/desk-notices.ts
---

## Change

`notifyTicket` no longer sends a desk a message per ticket change; it writes the change to `org_desk_notices`, and `reconcileCalendar` takes the queue with `takeDeskNotices` before a calendar event fires and appends `deskDigest` to the run's body.

## Purpose

Every ticket change woke the desk, a dozen times a day for one employee, each run doing one small thing; one batch per sweep lets a run handle all of them.

## Test

`reconcile.test.ts` "a blocked ticket reaches its owner at the next sweep, once": block a ticket, reconcile twice, assert the first sweep's body carries the line and the second does not.
```

- **`root` is the repository.** The directory, relative to the shared workspace, that the scope's paths start from — `root: typst.ts` when the repository sits in that folder. Leave it out only when the repository is the workspace itself. Look before you write it: `ls` the workspace.
- **`scope` is the only place a file path appears.** Each entry has a `kind` and a `file` (relative to `root`) and, optionally, a `name` — a regular expression, capture groups allowed, over the names the change touches in that file. The kind says what happens to the file: `edit` (it exists and changes), `new` (the change creates it), `delete` (the change removes it), `rename` (it moves: `from` is where it is now, `file` where it goes). The scope is a **subset**: the files and names the change is meant to touch, not everything it might. When the implementer finds it needs more, it tells you and you widen it; never write a scope you have not read.
- **The server checks the scope against the working tree.** `publish` refuses a scope whose `edit` or `delete` file, or whose `rename` source, is not under `root`, and names the likely path (the same path without a `legacy` segment, or files of that name elsewhere). Fix the path, or — if the change creates the file — list it as `kind: new`. A `new` file that already exists and a `rename` target that already exists are published with a hint; read it and correct the kind if it is right. Once a proposal is merged the check stops: its files have moved on.
- **The sections speak in interfaces.** `## Change` (or `## 改动`) says what is changed, naming functions, classes, routes and fields — never a path, never a link to a file; the server refuses a body with a file link. `## Purpose` (`## 目的`) says why, in one paragraph. `## Test` (`## 测试`) names one test case and says what it asserts. Add a section when the change needs one; do not pad the three.
- **Short.** A paragraph per section is the norm. A person comments on any passage they select, so every sentence should be one they can point at.
- **Where the body lives is the company's choice.** If the handbook keeps proposals as issues or as `rfcs/<n>-<slug>.md` in the workspace, write the file there and publish from it; the ledger the page renders is what you publish, and the issue or file is material you attach (`material add issue=<url>` / `doc=<url>`).

## The commands

```bash
penguin org proposal show <n>                                  # the brief, the current text, comments, events
penguin org proposal publish <n> --file proposal.md            # a revision; a comment follows its passage into the new text
penguin org proposal create --brief "…" [--author <colleague>]  # a proposal of your own (or handed to a colleague)
penguin org proposal implement <n> [--agent <colleague>] -m "…"  # the implementation session — yours, or a colleague's; prints its id
penguin org proposal ready <n>                                 # tell the person it can be read
penguin org proposal comments <n> --pending                    # the text with each commented passage marked ⟦<id>⟧…⟦/<id>⟧, then the comments by id
penguin org proposal resolve <n> <comment_id> -m "what changed"
penguin org proposal material <n> add doc=<url> --label "RFC"
penguin org channel send --channel proposals -m "@<colleague> proposal:<n> …"
```

Every write is attributed to you from your environment; there is nothing to pass.

## The loop

1. **Read the brief and the code.** `show <n>`, then the handbook and the code the brief points at. Decide the smallest change that does what was asked; that is the scope.
2. **Publish the first revision** and **open the implementation at once**: `implement <n> -m "<what to start with>"` opens a session of your own on the proposal; `--agent <colleague>` hands the build to a colleague instead. Do not wait for the person to read — the whole point is that reading and building overlap. The implementation session opens with the proposal text; it works on a `proposal/<n>-<slug>` branch against `dev` and reports through `feedback`.
3. **Mark it ready** as soon as it says what it should: `ready <n>`. The person sees a ready event; further revisions do not undo it. After a person has requested changes, `ready` is refused until you have answered them (step 5).
4. **A feedback event** (`@you proposal:<n> …` in the channel) means the implementation found something the text does not say — a file outside the scope, an interface that behaves differently, a test that cannot be written as described. Change the proposal to match reality: widen the scope, rewrite the paragraph, replace the test — then `publish` again. If the finding changes the purpose, say so in the channel and let the person decide.
5. **A batch of comments** (`@you proposal:<n> has a batch of <k> comments`) is one revision, not `k`: `comments <n> --pending` prints the proposal with every commented passage wrapped in `⟦<id>⟧…⟦/<id>⟧` and the comments listed by that id under it — the marks say exactly which words the person means; read the passage, not the id. Then, in this order: revise the file for all of them; `resolve <n> <id>` each with one line saying what changed (or why nothing did); `publish` once (a comment whose passage you kept follows it; one whose passage you rewrote is listed as a comment on the earlier revision — that is fine, it is answered by your `resolve` note); then `ready <n>`. The server refuses `ready` until a revision was published after the batch and every comment in it is resolved, and says which comments are still open. A person may send several batches; each is handled the same way.
6. **Runtime feedback** (`--runtime`, from the test team) on a proposal that is not yet approved is yours and the implementer's together: agree in the channel who changes what, revise the text where the behaviour changed, and let the implementer fix the branch.
7. **Approval** is the person's: they approve and request the merge, the implementer merges and reports `merged`. Your part ends when the text matches what was merged; if the merge diverged from the text, publish one last revision.

## Cautions

- **Never a file link in the body.** A path pulls the reader into the diff; the diff is the PR in the materials. If a paragraph cannot be written without a path, it is describing an implementation detail — leave it to the PR.
- **The desk does not build.** The branch and the PR belong to the implementation session — yours or a colleague's; the desk owns the text. A one-line fix goes into that session, not into the desk.
- **One proposal, one change.** A brief that asks for two things is two proposals; say so in the channel and ask the person to delegate the second.
- **The desk writes, a session builds.** Writing the proposal is desk work — reading code, thinking, one file. Anything that changes the workspace belongs to the implementation session.
