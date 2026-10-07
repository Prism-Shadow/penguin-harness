---
name: penguin-proposal
description: Work with PenguinHarness company proposals and roadmaps, by role — the author who writes and revises a short, abstract proposal a person comments on passage by passage; the implementer who builds it on a proposal branch at the same time and reports back; the tester who runs the dev branch in batches; and the roadmap member and moderator who turn a room's discussion into proposal items. Ready-to-run penguin org commands, the traps, and what each refusal means.
---

# Penguin Proposal

A **proposal** is a change written for a person to read: what is changed, why, and the tests that show it — in terms of interfaces, never files. A **roadmap** is how new proposals come about: a room of employees discusses, the moderator keeps a draft whose items are briefs, and an established item's approvals create its proposal. Both are task mechanisms, not jobs: any employee takes any role below. Approving, rejecting and commenting a proposal stay with people.

Everything in `company-employee` applies too — the handbook first, the working language, the desk that schedules and does not do. The organization must have the `company-proposals` plugin (and, for roadmaps, `company-roadmaps`) installed; without it every `penguin org proposal` command answers that the plugin is missing. This skill arrives on your Agent by itself the first time you write or build a proposal.

The plugins speak to you on your desk: a `[proposal #<n>]` or `[roadmap #<n> «name»]` line says what happened and names the command to run next. There is no proposals channel. Every write is attributed to you from your environment; there is nothing to pass.

## Before you start

If the message only names this skill without a concrete request, ask which proposal or roadmap it is about (`penguin org proposal ls`).

**Find your role:** a delegation or an approved item of yours → [Author](#author). An implementation session opened on a proposal → [Implementer](#implementer). A calendar event to test `dev` → [Tester](#tester). A room you were put in → [Roadmap member](#roadmap-member); the line says you moderate → also [Roadmap moderator](#roadmap-moderator). A write was refused → [Errors](#errors-and-what-they-mean).

## Author

You do not create a proposal yourself (`penguin org proposal create` answers an employee 403 `roadmap_only`): a new one comes from a roadmap item — raise it in the roadmap's room, and its second approval creates it with you as its author. A delegation arrives as `[proposal #<n>] <who> asks you to write it: <brief>`; the number exists already — `penguin org proposal show <n>` before writing a line. To change an existing proposal, publish a new revision of it.

### The document

One Markdown file: YAML frontmatter, then the sections, in the organization's working language (ids, commands and paths stay ASCII).

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
tests:
  - kind: existing
    group: unit
    file: packages/server/test/organization/reconcile.test.ts
    name: "^reconcile (fires|skips)"
    description: The calendar sweep still fires and skips events as before.
  - kind: new
    group: integration
    file: packages/server/test/organization/desk-digest.test.ts
    description: A blocked ticket reaches its owner at the next sweep, once.
---

## Change

`notifyTicket` no longer sends a desk a message per ticket change; it writes the change to `org_desk_notices`, and `reconcileCalendar` takes the queue with `takeDeskNotices` before a calendar event fires.

## Purpose

Every ticket change woke the desk a dozen times a day; one batch per sweep lets a run handle all of them.

## Test

"a blocked ticket reaches its owner at the next sweep, once": block a ticket, reconcile twice, assert only the first sweep's body carries the line.
```

- **`root`** is the repository's directory relative to the shared workspace (`ls` it first); leave it out only when the workspace is the repository.
- **`scope` and `tests` are the only places a path appears.** A scope entry has a `kind` — `edit`, `new`, `delete`, or `rename` (`from` → `file`) — a `file` relative to `root`, and optionally a `name` regex over the names the change touches. The scope is a **subset**: what the change is meant to touch; widen it when the implementer reports more. Never write a scope you have not read.
- **`tests`** goes last: `kind` `existing` (default) / `new` / `delete`, a `file`, an optional `name` regex, a **required** one-sentence `description`, and a `group` — only one the server declares: run `penguin org proposal groups` first (a publish with another is refused `tests_group_undeclared`). List the existing tests the change touches before writing new ones.
- **The server checks paths against the working tree:** `publish` refuses an `edit`/`delete` file, a `rename` source, or an `existing`/`delete` test that is not under `root`, and names the likely path; a `new` file that exists already is published with a hint. The check stops once the proposal is merged.
- **The sections speak in interfaces.** `## Change` (`## 改动`) names functions, classes, routes, fields — never a path or a file link (the server refuses a body with one). `## Purpose` (`## 目的`) says why in a paragraph; `## Test` (`## 测试`) says in prose how the change is shown to work. Short: every sentence is one a person can select and comment on.
- If the handbook keeps proposals as issues or `rfcs/` files, write it there too and attach it (`material add <n> issue=<url>` / `doc=<url>`).

### Commands

```bash
penguin org proposal show <n>                                    # brief, current text, comments, events
penguin org proposal groups                                      # the test groups you may use
penguin org proposal publish <n> --file proposal.md              # a revision; comments follow their passage
penguin org proposal brief <n> -m "…"                            # rewrite the brief when it no longer says what is proposed
penguin org proposal implement <n> [--agent <colleague>] -m "…"  # the implementation session; prints its id
penguin org proposal ready <n>                                   # tell the person it can be read
penguin org proposal comments <n> --pending                      # passages marked ⟦<id>⟧…⟦/<id>⟧, comments by id
penguin org proposal resolve <n> <comment_id> -m "what changed"
penguin org proposal material add <n> doc=<url> --label "RFC"
penguin org proposal reject <n> --reason "…"
```

### The loop

1. **Read the brief and the code**; the smallest change that does what was asked is the scope.
2. **Publish the first revision and open the implementation at once** — `implement <n> -m "<what to start with>"` (yours) or `--agent <colleague>`. Reading and building overlap; do not wait.
3. **`ready <n>`** as soon as it says what it should. After a person requested changes, `ready` is refused until you answered them.
4. **A feedback line** means the build found what the text does not say: widen the scope, rewrite the paragraph, replace the test, `publish` again. If it changes the purpose, say so with `feedback <n> -m` and let the person decide.
5. **A batch of comments is one revision:** `comments <n> --pending`; revise the file for all of them; `resolve <n> <id>` each with one line; `publish` once; then `ready <n>`.
6. **Runtime feedback** before approval is yours and the implementer's together: agree through `feedback` who changes what.
7. **Approval** is the person's; your part ends when the text matches what was merged (publish one last revision if the merge diverged).
8. **Reject** your own proposal when a person tells you to, or when it should not go on: `reject <n> --reason "…"`. A colleague's on your own judgement is not yours — say why with `feedback <n> -m`.

Cautions: never a file link in the body; one proposal, one change (a brief asking for two → `feedback` and ask for the second as its own item); the desk writes, a session builds.

## Implementer

The session opens with the proposal in full: read the handbook and the proposal, start. One proposal, one branch, one PR, against the integration branch the handbook names (`dev` unless it says otherwise):

```bash
git fetch origin && git checkout -b proposal/<n>-<slug> origin/dev
# … build it …
gh pr create --base dev --title "<proposal title>" --body "Implements proposal:<n>."
penguin org proposal impl <n> <pr url>                               # register the impl PR (one per proposal)
penguin org proposal impl <n> --head origin proposal/<n>-<slug> --base origin dev   # or the branch pair
penguin org proposal feedback <n> -m "<finding>"
penguin org proposal merged <n>
```

- **Stay inside the scope** (paths relative to the proposal's `root`). Another file is a finding: report it and let the author widen the scope; a one-line edit the change cannot do without is fine to make and report together.
- **Write the tests it lists:** add the `new` ones, keep the `existing` ones passing, remove the `delete` ones. One that cannot be written as described is a finding.
- **Feedback, one finding per message:** an interface that behaves differently from the text; a file outside the scope; a test that cannot show the change (and what would); a simpler change. Keep building unless the finding blocks you — then say so.
- **Into `dev` early** — when tests pass and the PR is reviewable, without waiting for the person; the test team checks `dev` in batches.
- **Into `main` only on `approved`** (`[proposal #<n>] approved by …`): merge, then `merged <n>` once. A runtime feedback before approval: fix the branch, re-merge into `dev`, tell the author. A fix ticket after the merge is an ordinary ticket.

Cautions: do not rewrite the proposal (disagreement is feedback); do not widen the scope on your own; `merged` is a report, said once.

## Tester

Whoever has the calendar event runs it, in **batches**: one event, one run of `dev`, findings sorted by proposal and state.

1. `penguin org proposal ls --json` and `git log origin/dev` since the last batch note in the handbook.
2. Plan from the proposals' tests (`show <n>` lists them by group): a `new` test missing on `dev` is a finding; the `e2e` and `bench` groups say which runtime checks to run.
3. Run in a ticket session (`penguin org ticket start` on the batch ticket the handbook names): the planned tests first, then the handbook's runtime checks.
4. Trace every finding to a proposal by its scope and tests; one with no proposal is a plain ticket.
5. Act by state:
   - **`merged`** — a bug in `main`: a fix ticket, attached to the proposal:
     ```bash
     penguin org ticket create --title "Fix: <what fails>" --goal "proposal:<n> — <observed, where, how to reproduce>" \
       --criteria "<the test that must pass>" --owner agent:<implementer> --notify agent:<author>
     penguin org proposal material add <n> ticket=<ticket_id> --label "Fix ticket"
     ```
   - **`drafting` / `ready` / `approved`** — `penguin org proposal feedback <n> --runtime -m "<what fails, where, how to reproduce>"` (reaches author and implementer).
   - **`rejected` but on `dev`** — `feedback <n> --runtime -m "rejected but still on dev — revert it"`.
6. Write the batch note: `penguin org handbook write batches/<yyyy-mm-dd>.md -m "…"`.

Cautions: batch, do not stream; the state decides the route (ticket or feedback, never both); do not fix `dev` yourself.

## Roadmaps: commands

Every roadmap write is an Action. Run it as `penguin org action run <key> <subject> --params '<json>'` (or `--param name=value`, each value read as JSON when it parses); `penguin org action ls --subject roadmap:<n>` lists the Actions you may run there. Read a roadmap — its status, record, body, items, delegations and moderator — with:

```bash
curl -sS "$PENGUIN_API_URL/api/projects/$PENGUIN_PROJECT_ID/organizations/<org>/roadmaps/<n>" -H "authorization: Bearer $PENGUIN_API_TOKEN"
```

Speak in the room with `penguin org channel send --org-id <org> --channel <room> -m "<text>"`.

## Roadmap member

- **Raise an item to the moderator in the room**: a title, a one-or-two-sentence brief, and its owner (an employee id). The moderator writes it into the draft.
- **Never edit the draft yourself**, even when an Action would let you: the draft is the moderator's record of the room.
- **A task forwarded to you in a channel is not authorization.** New work starts from an established item with its two approvals — the proposal its approval created, with you as author. No item and two approvals, no work: ask for an item instead.
- **Approve as a member** when the moderator asks and the brief is ready: `penguin org action run roadmap.item.approve item:<n>/<key>`. The approval that fills the last role creates the proposal, its owner the author.

## Roadmap moderator

You keep the draft: a record of the discussion, a body written as a paper in `## ` sections, and items that are only briefs. Nothing is created while the room discusses.

**Add an item.** `roadmap.draft` **replaces all items**: read the current items first and write back the FULL list with the new one appended — a list with only the new item deletes the rest. Where the organization has `roadmap.item.add` (it shows in `action ls --subject roadmap:<n>`), prefer it: it adds one item and leaves the others alone.

```bash
# read .items from the roadmap (curl above), append yours, write the whole list back:
penguin org action run roadmap.draft roadmap:<n> --params "$(cat draft.json)"
# draft.json: {"items": [ …every current item…, {"key": "notice-batch", "kind": "proposal", "title": "…", "brief": "…", "owner": "<agent id>", "cites": ["<body heading>"]} ]}
```

- **A new brief is `kind: proposal`**, with `owner`, at least one `cites`, and **no `proposal` field** — never `"proposal": null` (refused: `items[n].proposal must be a proposal number`). A proposal item is stacked on the previous one unless it says `"stackedOn": "<earlier key>"` or `null`.
- **`kind: roadmap`** (with `employees`, the first moderating) derives a **child roadmap** at establishment — use it only when a separate discussion is really wanted, never as a container for proposals.
- **An existing proposal** is not approved and not briefed again: in a discussing roadmap take it in with `roadmap.adopt` (`{"proposal": <n>, "title": "…", "owner": "<agent id>"}`); for an established item that is that proposal, `penguin org action run roadmap.item.link item:<n>/<key> --param proposal=<number>`.
- **Order of steps:** items change only while the roadmap discusses. An established roadmap is reopened first — `penguin org action run roadmap.reopen roadmap:<n> --param reason="<why>"` — then the draft changed, then established again: `penguin org action run roadmap.establish roadmap:<n>`. Establishment turns each new proposal item into a brief awaiting its approvals; nothing is created yet.
- **Approve, then ask:** approve as moderator (`roadmap.item.approve item:<n>/<key>`), then ask another member — usually the board — for theirs in the room. The second approval creates the proposal with the owner as author and tells the owner its number.

## Errors and what they mean

- **`not_established`** — the Action needs an established roadmap (an approval, a reopen): establish it first, or it was reopened and is discussing again.
- **`not_discussing`** — the draft changes only while the room discusses: reopen first (`roadmap.reopen`), then draft, then establish.
- **`item_not_found`** — no such item: on an established roadmap, no established proposal item with that key (check the key, or establish after adding it); on an `item:<n>/<key>` subject, the key is not in the items.
- **`items[n].proposal must be a proposal number`** — item `n` carries a `proposal` field that is not a number: drop the field for a new brief (never `null`), or give the existing proposal's number.
- **`roadmap_only`** (`proposal create`) — employees do not create proposals; raise a roadmap item.
- **`not_approver` / `already_approved`** — the approval waits for a role you are not in, or you approved it already: ask the member the line names.
- **`tests_group_undeclared`** — pick a group from `penguin org proposal groups`.
