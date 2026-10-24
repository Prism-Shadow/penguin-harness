# PRFC-0016 Company-mode proposals: the person reads one while the Agent builds it at the same time

[中文版](PRFC-0016-company-proposals.zh.md)

> **Source**: `rfcs/PRFC-0016-company-proposals.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210) (draft); the unmerged revision that the open design PR [#233](https://github.com/Prism-Shadow/penguin-harness-design/pull/233) makes to this draft has been folded into this document.
> **Rev**: v1.0.0 (migrated into the main repository, taking the open chain's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `company_proposals`
- Start Date: 2026-09-21
- PRFC PR: [Prism-Shadow/penguin-harness-design#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210)
- Implementation PR: [Prism-Shadow/penguin-harness#825](https://github.com/Prism-Shadow/penguin-harness/pull/825) (draft, stacked on top of the PR-chain head #818)

## Summary
[summary]: #summary

Add a **proposal** to company mode: a person delegates a change to an employee, or an employee proposes one themselves (the CEO proposing a plan to the board is the most common case); the author writes a short, abstract proposal whose individual passages can be commented on, and **starts the implementation at the same time** — by default the author does it themselves, or it can be handed to a colleague — with the implementation attached as a GitHub PR material, neither side blocking the other. It is a task mechanism, not a role: nobody is hired for it. The proposing employee revises per implementation feedback, and the person sees the revisions and the "ready" state on the page; the person selects passages of text to comment on, batches them, and sends them back as changes to address; on approval they request the merge. Runtime problems after the merge arrive as tickets, those before the merge as change requests — both surfaced by the test team batch-testing the dev branch.

It ships as a **plugin**, **disabled by default**: a code plugin (server module, routes, page contribution) and a content plugin (the three-part protocol, as three Skills); the code plugin installs the content plugin onto the employee automatically when someone writes or works on a proposal. The plugin provides only the proposal's **ledger and interface** — numbering, passages, comments, events, unread counts, linked materials — while where the proposal body comes from (a GitHub issue, an RFC file in the repository) is the company's own business; the employee delivers it into the ledger via `penguin org proposal`. The prototype sets up no extension points — it just builds this one form out completely.

## Motivation
[motivation]: #motivation

Company mode's "proposal" today is nothing more than a convention: the CEO writes a paragraph @-mentioning the board in the all-hands channel and stops there (05 "Organization Handbook", "decisions belong to the board"). Nothing records whether a proposal is open, answered, or revised; what the person reads is one long channel message, the reply is another message, and the second round of changes is written from scratch as yet another message. What a ticket carries is **what to do**, not **why the change is made this way and which interfaces it touches** — and reviewing a change needs the latter.

The real bottleneck sits on the person's side: people read slowly. Today an employee either waits until the person finishes approving before starting (the person becomes the throughput bottleneck), or does the work first and presents it afterwards (the person is handed a fait accompli). This proposal wants a third way: **while the person is reading, the Agent is already building**, and what the building finds in turn sharpens the proposal; by the time the person approves, the implementation is already sitting in a PR waiting to be merged; and even if the person never reads it, the implementation has already landed in the dev branch and gone through the test team's paces — it doesn't rot waiting for the person.

Scenarios:

- **Delegating a refactor.** The person clicks "New proposal" on the proposals page, picks employee `acme_dev`, and writes a one-line delegation: "change the organization scheduler's ticket notifications to per-employee batch delivery". `acme_dev` writes proposal #12: the interfaces to change, the how, the goal, one test case; and asks `acme_impl` to start at the same time. The next day the person opens the proposals page and sees #12 ready, with two revisions and the PR among the materials.
- **Passage comments.** In the "Changes" section the person selects the words "`reconcileCalendar` calls `takeDeskNotices` before the schedule trigger" and writes "doesn't say who calls it"; in the "Tests" section they select a test-case name and write "should cover no repeats after a restart", then click "Request changes" — the two comments become one batch and `acme_dev` receives it once: the commented text in the body is wrapped in `⟦c1⟧…⟦/c1⟧`, one revision, one reply.
- **Implementation feeds back into the proposal.** `acme_impl` discovers the change touches a file the proposal didn't list and says so with `feedback`; `acme_dev` adds it to the scope and publishes a third revision; the person sees a "revised" unread event.
- **Approval and merge.** The person clicks "Approve and request merge"; `acme_impl` merges the PR into main and reports `merged`.
- **The test team.** Once a week, `acme_qa` pulls the dev branch and runs it through: #12 is merged and has a regression — open a fix ticket attached to #12; #13 isn't approved yet and crashes — send a runtime feedback to #13's author and implementer, who address it together.
- **Links.** `proposal:12` appearing in a channel message or a conversation renders as a pill "#12 Batch-deliver ticket notifications · 2" — title plus unread count — and clicking it opens the proposal page.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### Terms

- **Proposal**: a reviewable description of a change, belonging to one organization and numbered incrementally within it (`#12`). It has an **author** (the employee who writes it: the one named, otherwise the employee who initiated it), an optional **implementer** (the employee who builds it, by default the author themselves), and an **initiator** (`delegatedBy`: the person or employee who initiated it, recorded as a principal `user:<id>` / `agent:<id>`).
- **Scope**: the files and interfaces to change — a list of `<kind, file, optional name pattern>`, the pattern being a regular expression with capture groups. The kind says what happens to the file: `edit` (already exists, to be modified), `new` (created by the change), `delete` (deleted by the change), `rename` (renamed: `from` is the current path, `file` is the new path). Paths are all relative to the proposal's **root** (`root`: the repository's directory within the shared workspace, defaulting to the shared workspace itself). The scope is a **subset** of the change; the implementation should try not to exceed it; when it does, the implementer feeds it back and the author adds it to the scope. **File paths appear only in the scope and the tests.**
- **Tests**: the tests that prove the change — a list of `<file, optional name pattern, kind, group, description>`, placed last in the frontmatter (it can be long). The file is relative to `root`; the name pattern is like the scope's, a regular expression over test names within that file; the kind is `existing` (already present, the default: the change must keep it passing, or modify it), `new` (to be added), or `delete` (the change removes it; with a name pattern only the matching cases are deleted, and the description says why); the group defaults to `unit` and **can only be one of the groups declared in the plugin configuration** (see "Test groups" below); **the description is required**: what this test tests. It lists both the related existing tests and the tests to be added or removed.
- **Sections (the body)**: three fixed sections — **Changes** (what changes, speaking only in interfaces, no file paths), **Purpose**, **Tests** (a prose account of how the change is proven; the concrete test files are listed in the "tests" list); the author may append further sections. **Any passage of text** in the body can be selected for comment.
- **Materials**: evidence of the implementation — usually a GitHub PR; it can also be an issue, a branch, a document, any URL. Materials carry links; the body doesn't. If a `pr` material points at a GitHub pull request, reading the proposal asks GitHub once for its status — draft / pending merge / merged / closed — cached per URL for a minute, not shown on failure, and **never written into the ledger**; a GitHub token stored on the server is sent along when present.
- **Revision**: each time the author runs `publish`, the revision number increments; passages correspond by content, and unchanged passages keep their ids and comments.
- **Comment**: one remark the person writes on a passage of text. The anchor is a **range** in that section's Markdown source (paragraphs joined by blank lines) — stored as offsets `[start, end)` plus the quoted text `quote`; on each revision it is relocated by `quote` (exact match first, then whitespace-collapsed), and a comment that can no longer be found stays on the revision where it last lived ("text of revision N"). When shown to an Agent, **no offsets are given**: the commented text in the body is wrapped in `⟦<id>⟧…⟦/<id>⟧`, the comments are listed below keyed by the same id, and `resolve` uses it too. A comment is **pending** at first; after commenting several times the person clicks "Request changes" once, and the pending comments are combined into **one batch** sent to the author; the author **resolves** them one by one. A pending comment belongs to whoever wrote it: it can be edited or withdrawn at any time; once sent (request changes) it is frozen, and what the author reads is its final wording.
- **Event**: one record of everything that happens on a proposal (created, revised, ready, changes requested, implementation started, material, feedback, approved, merged, rejected). Each person has a read position per proposal; the events after it are **unread**.
- **Status**: `drafting` (the author is writing or revising) → `ready` (the author says it can be read) → `approved` (the person approves and requests the merge) → `merged` (the implementer reports it merged); `rejected` at any moment. Requesting changes moves `ready` back to `drafting`.

### How the person uses it

The company-mode navigation in the sidebar gains a **Proposals** row; its badge is the sum of unread events across all proposals. Proposals have two pages: the **queue** is a full-width list — one row per proposal (number, title as link, status pill, author, unread count, last updated) — unread first, then by descending number, with "New proposal" in the page header. Above the queue is a GitHub-style search box: the default is `is:open` (in progress: drafting / ready / approved), with merged and rejected hidden by default; the syntax is whitespace-separated terms — `is:<open|drafting|ready|approved|merged|rejected|closed>` (`status:` is a synonym), `author:<id>`, `implementer:<id>`, `by:<initiator>`, `unread:yes|no`, `no:implementer`, `-` for negation, `"…"` for phrases, everything else free text over number and title; same key ORs, different keys AND. The query is written into `?q=` (omitted when it equals the default), linkable and preserved across refresh. Below the box is a row of quick pills: Open / Ready / Approved / Merged / Rejected / All (replacing the `is:` term), plus a separate "has unread" toggle, each with a count; clicking a title opens the **proposal page** — a standalone page, not in the sidebar: a breadcrumb back to the queue, a header (title, number, status, author and implementer, initiator, revision number), materials (one per row: kind, title as link, the PR's status pill, address), scope (one file per row, the name pattern wrapped onto a line below), the body, the event timeline, and an action bar at the bottom: **Request changes (N)** (N is the number of pending comments), **Approve and request merge**, **Reject**. Comments can be left in two ways: hovering over a passage lightly highlights it and shows a "Comment on this passage" button at the right edge — clicking uses the whole passage as the quoted text (no precision aiming needed); or select a stretch of text in the body and a "Comment on the selection" floater pops up. Writing it records it as pending; existing comments appear as markers laid over the quoted text (pending in attention color, sent in neutral, resolved dimmed), and clicking a marker expands the comment under that section.

The body contains only interface names, no file links — reading a proposal is reading "what changes and why", not reading a diff; the diff is in the PR among the materials.

`proposal:12` in any Markdown surface (channel message, conversation, proposal body) renders as a pill: `#12 <title> · <unread count>`. The optional fragment `proposal:12#<pattern>` matches section headings and paragraph first lines by regular expression, the first capture group becomes the pill text, and clicking scrolls to the match. This is the proposal's **only stable external link form**.

### How employees use it

The content plugin `agent-company-proposals` carries the three-part protocol (three Skills), **not three roles**: the code plugin installs it onto the author at creation and onto the implementer at `implement` (left alone if already installed); nobody needs to install it by hand, and nobody is hired for it. An employee initiating a proposal themselves uses `penguin org proposal create --brief …` (the author defaults to themselves; `--author <colleague>` is how it goes to someone else).

- **`proposal-author`**: receives the delegation (a `[proposal #<n>]` line on the desk, or the person talking directly) → reads the handbook and the relevant code → `penguin org proposal publish <n> --file <md>` (the body format is below) → `penguin org proposal implement <n>` opens their own implementation session (`--agent <colleague>` is how it goes to a colleague) → `ready` → after that, every line arriving on the desk (a batch of comments, one feedback) is a revision: `comments --pending` to read the batch, revise the draft, `resolve` each one, `publish`, then `ready` again (the server rejects `ready` when the order is wrong, see "State machine"). Rules: the scope lists only a subset; the tests list the related existing tests and the tests to be added, each with a note on what it tests; the body mentions only interfaces, no paths; keep each of the three sections to one paragraph where possible.
- **`proposal-implementer`** (the implementation session — the author's own, or a colleague's): the implementation session opened by `implement` starts with the proposal's full text → create the `proposal/<n>-<slug>` branch in the shared workspace's repository → implement, open a PR (targeting the dev branch) → `material <n> add pr=<url>` → where the implementation disagrees with the proposal, say so with `feedback <n> -m` → merge into dev as soon as the implementation is usable (without waiting for the person's approval) → once "approved" arrives, merge into main, `merged <n>`.
- **`proposal-tester`** (whoever holds this calendar event does it): batched by the calendar: each proposal's test list is the batch's plan (a test planned as new but not yet on dev is itself a finding); pull the dev branch, run the planned tests first, then the remaining tests and runtime checks → trace each finding to a proposal: one already `merged` gets a fix ticket (`penguin org ticket create … --notify` the author, `ticket=<id>` attached as material); one not yet `approved` gets `feedback <n> --runtime -m`, and the author and implementer address it together.

The proposal body's file form (`publish --file`):

```markdown
---
title: Batch-deliver ticket notifications per employee
root: penguin-harness
scope:
  - kind: edit
    file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket|reconcileCalendar"
  - kind: new
    file: packages/server/src/runtime/organization/digest.ts
tests:
  - kind: existing
    group: unit
    file: packages/server/test/organization/reconcile.test.ts
    name: "^reconcile (fires|skips)"
    description: the schedule sweep still fires and skips as before
  - kind: new
    group: integration
    file: packages/server/test/organization/desk-digest.test.ts
    description: a blocked ticket reaches its owner at the next sweep, once
---

## What this changes

`notifyTicket` no longer sends one message to the desk per event; it writes to `org_desk_notices` instead; `reconcileCalendar` calls `takeDeskNotices` before the schedule trigger and appends `deskDigest` at the end of the body.

## Purpose

Every ticket status change wakes the desk; the same employee gets woken a dozen times a day, each time for one small thing; batched delivery lets one sweep handle all the changes.

## Tests

`reconcile.test.ts` "a blocked ticket reaches its owner at the next sweep, once": block a ticket, run reconcile twice, assert the first schedule's body contains that line and the second's does not.
```

Everything the plugin tells an employee — a delegation, a request for changes, a feedback, an approval, a rejection — arrives as one `[proposal #<n>] …` line delivered straight to that employee's desk, through no channel and in nobody's name (see "Delivery").

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Delivery form

| Package | Directory | Form | Default |
| --- | --- | --- | --- |
| `@prismshadow/penguin-plugin-company-proposals` | `plugins/company-proposals` | Code plugin (PRFC-0003): one module, contributing a route group, pages, and a configuration group | In no Project's `[plugins]` table |
| `@penguinharness/agent-company-proposals` | `plugins/agent-company-proposals` | Content plugin: the three Skills `proposal-author` / `proposal-implementer` / `proposal-tester`, `category: agent-company`, `preinstall: false` | Installed on no Agent |

The same pairing as `claude-code` / `use-claude-code`: a code plugin cannot carry Skills today. With the code plugin installed but no Skill, the pages and API are all there while the employee doesn't know the protocol; with the Skill installed but no code plugin, the CLI gets a 404 saying "the proposals plugin is not enabled for this organization".

### Ledger

One ledger per organization: `<orgDir>/proposals.jsonl`, an append-only event log, replayed in full into memory on startup or hot reload; the server is the sole writer (the same line as `desks.toml`: a fact file, not edited by employees). No directories or tables are created: the ledger is the plugin's own thing — unlike tickets' "one file per ticket" — the **source** of the body is the company's business (a GitHub issue, an RFC under `rfcs/`); what the ledger records is **the copy delivered into it**.

Each person's read positions live in `server_settings`: key `company-proposals:reads:<projectId>/<orgId>/<userId>`, value `{ [number]: lastSeq }`.

Records in the ledger (one per line, `seq` increasing):

```ts
type LedgerLine =
  | { seq; at; kind: "created"; number; title; author; delegatedBy; brief }
  | { seq; at; kind: "revised"; number; revision; title; root?; scope; tests?; sections; by }  // root defaults to ""; tests default to []
  | { seq; at; kind: "status"; number; status; by; reason? }
  | { seq; at; kind: "implementation"; number; implementer; sessionId; by }
  | { seq; at; kind: "material"; number; material: { kind; label; url }; by }
  | { seq; at; kind: "feedback"; number; text; runtime: boolean; by }
  | { seq; at; kind: "comment"; number; id; sectionId; start; end; quote; revision; text; by }  // pending
  | { seq; at; kind: "comment_edited"; number; commentId; text; by }      // edit a pending comment (not an event)
  | { seq; at; kind: "comment_deleted"; number; commentId; by }            // withdraw a pending comment (not an event)
  | { seq; at; kind: "batch"; number; id; commentIds; revision?; by }       // request changes; revision defaults to the current revision at fold time
  | { seq; at; kind: "resolved"; number; commentId; text; by }
  | { seq; at; kind: "notify_failed"; number; text; by };                 // desk delivery failed: reason
```

The folded `Proposal`: `number`, `title`, `status`, `revision`, `author`, `implementer | null`, `delegatedBy`, `brief`, `root`, `scope: { kind; file; from?; name? }[]`, `tests: { kind; file; name?; group; description }[]`, `sections: { id; heading; paragraphs: { id; text }[] }[]`, `materials`, `sessions`, `comments: { id; sectionId; range: { start; end }; quote; paragraphId?; revision; text; by; at; batchId | null; resolved? }[]` (`paragraphId` is derived from `start`; at fold time every `revised` line relocates comments by `quote`, and a comment written against a paragraph in the first version anchors to the whole paragraph), `events` (every line except `comment` is an event; pending comments are invisible to the author), `unread` (computed for the caller). Reads (`GET /:number` and every write's response) additionally attach `base` (the absolute directory the server resolves `root` to) and a `state` per scope entry: `edit` — `exists` if present, else `missing`; `new` — `exists` if present, else `new`; `delete` — `exists` if present, else `deleted`; `rename` — `exists` if the target is present, `renamed` if only the source is, `missing` if neither; each test also carries a `state`: `exists` if the file is present, else `missing` for `existing` / `delete` and `new` for `new`. States are computed on each read and never enter the ledger.

**Old ledgers.** In ledgers written before kinds existed, scope entries have only `file` and `name`. When loading the ledger, the plugin reads such entries in memory as `kind: "edit"` and **does not rewrite the file on disk**; revisions published thereafter are written with an explicit kind. Revisions written before tests existed have no `tests`; they are read as an empty list, likewise without rewriting the file.

**Paragraph correspondence.** `publish` splits the Markdown into sections by headings and into paragraphs by blank lines (code blocks and lists count as one whole paragraph); each paragraph's id is taken from the **same-text** paragraph in the previous revision, or a new `p<n>` is allocated. Comments anchor to paragraph ids; when a paragraph disappears in a new revision, its comments still list at the end of that section, marked "see revision N".

**Validation.** `title` non-empty; `root` a relative path within the shared workspace; `scope`'s `file` a relative path, `name` a valid regular expression, every entry with a kind, `rename` must carry `from` and the other kinds must not, the same file must not appear twice; each `tests` entry's `file` a relative path, `name` a valid regular expression, `kind` one of `existing` / `new` / `delete`, `group` matching `[a-z0-9_-]{1,32}`, `description` non-empty — otherwise `400 tests_invalid`; a `group` not among the declared groups is `400 tests_group_undeclared`, the error listing the declared groups and their descriptions (undeclared groups already used by revisions in the ledger are not rewritten; they are only rejected at the next publish); the body must contain at least the three sections "Changes", "Purpose", and "Tests" (headings in both Chinese and English are recognized); links in the body that point to files (`](` followed by a path, or `file:`) are rejected with `400 proposal_body_links_files` — the body speaks only in interfaces.

**Test groups.** Groups are **plugin configuration**: the plugin declares a "company proposals" settings group via `PluginConfigProvider.groups`, whose `testGroups` is a list field with one `id: description` per line (`id` matching `[a-z0-9_-]{1,32}`, the line format validated by the field's `pattern` on save), the line order being the display order; the default is the four lines `unit`, `integration`, `e2e`, `bench`. An administrator edits it under "Settings → Plugins"; through the platform's plugin configuration it applies to **the whole server**, not per organization. The plugin reads it via `PluginConfig.get` on each use; after a save, the next publish and read follow the new values, no restart needed. `GET …/proposals/test-groups` returns `{ groups: { id; description }[] }`; reading a proposal also returns them as `testGroups`; the CLI `penguin org proposal groups` prints them — the author checks before writing tests.

**Scope checked against the workspace.** The plugin runs on the service that holds the organization, and the shared workspace is a local directory, so `publish` checks against it: if `root` is not a directory, or an `edit` / `delete` file or a `rename` source doesn't exist under `root`, the revision is rejected (`400 proposal_scope`), listing each missing path along with possible paths — a path that exists after dropping a `legacy` segment, or same-named files found by a bounded breadth-first search (skipping hidden, dependency, and build directories, with limits on depth and entries), at most two — and a hint that files to be created are written as `kind: new`. An existing file for `new`, or an existing `rename` target, is not rejected; the response carries `hints`. Tests are checked the same way: an `existing` or `delete` test whose file doesn't exist under `root` is rejected (`400 tests_missing`, likewise with possible paths and a hint that tests to be added are written as `kind: new`); a `new` test whose file already exists is not rejected, with `hints` (the new tests go into this file). Merged proposals are no longer checked: their files have long since changed.

### State machine

```text
created ──publish──► drafting ──ready──► ready ──approve──► approved ──merged──► merged
                        ▲                  │  ▲                │
                        └───request changes┘  └────publish─────┘        any state ──reject──► rejected
```

- `publish` is allowed on top of `ready` / `approved` / `merged`; only `rejected` refuses revisions. **An approval covers exactly one revision**: a `publish` on top of `approved` moves the proposal back to `ready` (in the ledger, a `revised` line immediately followed by a `status ready` line with a reason), so the implementer cannot merge on a stale approval; `approvedRevision` remains, recording which revision was approved — the page shows the diff since the approval accordingly, and the person simply approves again. The `approved` line carries its own `revision`; old lines without the field are read against the current revision at fold time. Every revision's full text stays in the ledger, readable back by number.
- **The author's `ready` must first answer the changes.** When changes have been requested since the last `ready`, the author's (employee's) `ready` is accepted only when both hold: a revision has been published after the latest batch (`revision` greater than the one that batch recorded), and every comment in those batches is `resolve`d; otherwise `409 changes_pending`, the message listing the unresolved comment ids and ending with `penguin org proposal comments <n> --pending`. The person marking `ready` is not bound by this.
- `approve` only a person can do, and it need not wait for the author's `ready` (approving a `drafting` draft after reading it is the person's prerogative); `reject` a person can do; `merged` only the implementer or a person can do; `ready` only the author or a person can do.
- Who is who: the same rules as ticket routing — a request from a session is attributed to an employee by `sessionId` / `agentId`, otherwise it is the logged-in user (05 "Tickets and ticket sessions", "Actor").

### Delivery: straight to the desk

The plugin **uses no channels** and **adds no trigger kinds** (`OrgTriggerKind` belongs to core, and company mode's rule is not to touch core). It has exactly one way to speak to an employee: via the gateway's `deliverToDesk`, sending one line of text to the employee's **desk** as the desk's next user input (sender `server`, the same origin as calendar triggers), queued behind the in-progress Task when the desk is busy. This line is issued **in nobody's name**: it starts with `[proposal #<n>] `, followed by what happened, who did it, and the next command to run. An employee is never told about what it did itself (skipped when the actor is the recipient). Six cases:

| Occasion | To | Text |
| --- | --- | --- |
| Created (the author is not the initiator themselves) | Author | `[proposal #<n>] <initiator> asks you to write it: <brief>` + the `publish` / `ready` commands |
| Changes requested | Author | `[proposal #<n>] <person> requested changes: a batch of <k> comments` + `comments <n> --pending` / `resolve` |
| Feedback | Author (runtime feedback adds the implementer) | `[proposal #<n>] feedback from <who>: …` / `runtime feedback from <who>: …` |
| Approved | Implementer (the author if there is none) | `[proposal #<n>] approved by <person> — merge the PR and run penguin org proposal merged <n>` |
| Revised after approval | Implementer | `[proposal #<n>] revised after approval (revision M → N) — wait for a new approval before merging.` |
| Rejected | Author and implementer | `[proposal #<n>] rejected by <person>: <reason> — stop work on it, and close its PR if one is open.` |

`implement` sends no additional line: the implementation session's first input already hands the proposal to the implementer. When the organization is paused, or the employee's (or their superior's) budget is paused, the gateway refuses delivery and says why (`org_paused` / `employee_paused`); with no desk it is `desk_unavailable`. A failed delivery does not roll back the ledger write: it is recorded as a `notify_failed` line (becoming an event) and returned as `hints` with that write's response — shown as a notice on the page, printed by the CLI — and still logged.

The **implementation session** opened by `implement` is isomorphic to a ticket session: a new `client: "org"` session created under the implementer's Agent (Workspace defaulting to the shared workspace, overridable with `--workspace`), the first input being a preamble + the proposal's full text + a postscript, the session id recorded in the ledger's `sessions`. This step goes through the organization gateway the server opens to plugins (see "Platform changes"); no ticket-session code is copied.

### API

Route group `company-proposals.routes`, prefix `/api/projects/:projectId/organizations/:orgId/proposals`, `auth: user`, ordered before `OrgRoutes.routes` (145); with the company-mode master switch off, everything is 404, consistent with the organization routes; the read/write permission is Project membership.

```text
GET    /                         list (each with its unread)
POST   /                         { title?, brief, author? }           → create (the author defaults to the initiating employee; a person must be named) + notify the author's desk (when the author is someone else)
GET    /:number                  detail (folded state; pending comments visible only to the delegator / the comment's own author; includes approvedRevision)
PUT    /:number                  { markdown }                         → publish (a revision; on top of approved, back to ready)
GET    /:number/revisions        each revision's { revision, by, at }
GET    /:number/revisions/:rev   the title, scope, and sections as published at a revision (404 revision_not_found)
GET    /:number/file?path=       one file under `base`, read-only: { path, size, binary, truncated, content, extension } — an absolute path or one containing `..` is 400 bad_path, resolving outside `base` through symlinks and the like is 403 path_outside, a non-regular file is 404 file_not_found; reads at most 512 KB, a NUL in the first 8 KB makes it binary (content null)
POST   /:number/ready | /approve | /reject { reason } | /merged
POST   /:number/implement        { agentId?, message?, workspace? }   → implementation session (defaulting to the author's own)
POST   /:number/materials        { kind, label?, url }
POST   /:number/feedback         { text, runtime? }
GET    /:number/comments[?pending=1]  comments (pending: sent but unresolved), with text: the commented text wrapped in ⟦<id>⟧…⟦/<id>⟧ and the comments listed by id — the form Agents read
POST   /:number/comments         { sectionId, start, end, quote, text } → pending (quote must equal the source over that range, else 400 comment_range)
POST   /:number/comments/request                                      → batch them + notify the author's desk
PATCH  /:number/comments/:id     { text }                             → edit a pending comment (only its own author)
DELETE /:number/comments/:id                                          → withdraw a pending comment (only its own author)
POST   /:number/comments/:id/resolve { text? }
POST   /:number/read             { upTo: seq }
```

After every write, a user-level event `{ type: "plugin", plugin: "company-proposals", data: { projectId, orgId, number, seq } }` is pushed to the Project; the page and the sidebar badge refresh off it.

CLI: `penguin org proposal ls | show <n> | create --author <id> --brief <s> [--title] | publish <n> --file <md> | ready <n> | implement <n> --agent <id> [-m] [--workspace] | material <n> add <kind>=<url> [--label] | feedback <n> -m <s> [--runtime] | comments <n> [--pending] | resolve <n> <commentId> [-m] | merged <n> | approve <n> | reject <n> --reason <s> | groups`. `groups` prints the declared test groups. `show` prints the tests after each section, grouped (in declaration order, undeclared groups marked): `<kind> <file> [<name>] — <description> (<state>)`. The same thin-client contract as `penguin org ticket`: API errors pass through verbatim, identity comes from the session's control environment. It lives in the platform CLI (see Unresolved).

### Pages

Contributed via the code plugin's `WebModule.pages`: `{ key: "org-proposals", path: "proposals/:number?", nav: "org", renderer: { builtin: "OrgProposalsPage" } }`. The renderer ships with the Web build (platform rule: contributions carry data, never code) — when the plugin is absent the contribution doesn't exist, and neither the route nor the nav row appears.

- Two pages, one route (`proposals/:number?`): without a number it's the queue — a full-width list, one row per proposal (`#n`, title as link, status pill, author, unread count, last updated; unread first, then by descending number); with a number it's the proposal page, a standalone page with no sidebar queue.
- Proposal page: breadcrumb, header, and — when a revision follows an approval — **exactly one line** under the header ("revised since the approved revision M (→ revision N)", who approved it and when, and a "Changes | Latest" toggle defaulting to "Changes"; this line never lists the changes, and on a phone folds to at most two lines). Under "Changes", **every change is marked in place**: the title shows added and removed words in the header; for each scope and test row — added ones get a success background plus a thin left edge, removed ones are struck through in danger color, stay in their original position (after their nearest surviving predecessor), and are not links, and modified ones (a scope's kind / `from` / name pattern, a test's kind / group / description) show the old value struck through with the new value colored beside it; the delegation (brief) is not part of a revision and is not marked. The body: sections align by heading, and within a section paragraphs run through a longest common subsequence — unchanged paragraphs render as usual (comment markers and hover comments unchanged); added paragraphs get a success background plus a thin left edge; removed paragraphs are struck-through plain text in danger color, not commentable; a removed-added pair with word overlap ≥ 0.5 merges into one paragraph with added and removed words marked in place (CJK segmented per character); a wholly added section is marked "added", a wholly removed one is struck through and marked "removed", staying in its original position. "Latest" is the current proposal exactly as it is, with no markers. The materials list (one per row: kind icon and word, title as link, the `pr` status pill — draft gray, pending merge brand, merged success, closed danger — plus a gray address), the scope list (one line above the list names the root; one file per row, with a kind label in front (`rename` written "source → new path") and a status label behind, the name pattern written below on a second line in monospace, wrappable — an overlong pattern no longer crushes the table into one column; only files whose state is `exists` are links: clicking opens the file read-only in a **file panel to the right of the proposal**, without navigating away — on wide screens it sits beside the proposal (about 45%, never narrower than 360 px, with a draggable divider between), on narrow ones it covers the whole page; the file is read by the plugin from the server hosting the organization (`GET …/:number/file`, confined to `base`), with line numbers and syntax highlighting; when a name pattern is present, the matched lines and the first capture group are marked and it scrolls to the first match, or one line above the code says there is none; the opened file goes into `?file=` (and `name=`), survives refresh, closes on back navigation and on Esc; a `missing` row's hover tip explains the file doesn't exist under the root; files are never opened in the browser), the body (each paragraph rendered as Markdown; comments lay over the quoted text as `<mark>` — found in that section's text nodes by `quote` after rendering and wrapped, pending in attention color, sent in neutral, resolved dimmed; clicking a marker expands the comment under that section), each paragraph lightly highlighting on hover with "Comment on this passage" at the right edge (the whole passage is the quoted text, the range being that paragraph's span in the section source), and selecting a stretch of text popping the "Comment on the selection" floater — the selection is first matched in the section source's "plain-text projection" (backticks, emphasis, heading and list markers, link targets stripped) to get a source range, then falls back to matching the source directly, then to the whole containing paragraph — and writing posts `POST comments` immediately; comments on older revisions list after the body. The test list (after the body, before the event timeline): grouped, in declaration order, each group's subheading followed by one gray line giving the group's description; groups used by the revision but no longer declared go last in alphabetical order under an "undeclared groups" subheading, with one line saying the next publish must move them; each group is a count-bearing, collapsible subheading, expanded by default, and a group with more than 12 rows shows the first 12 plus a "show N more"; each row is a kind label (`existing` neutral, `new` success, `delete` danger), the file (the same kind of link as the scope, clickable only when it exists; `existing` / `delete` with a missing file marked danger), the name pattern (monospace, gray, wrappable), the description. The event timeline (relative time, principal display name, one sentence), and the action bar (stuck to the bottom).
- Interactions follow 06 "company-mode prototype": no page switches within the page; titles are links; statuses use text pills, not dots; "Approve" and "Reject" go through the unified confirmation dialog.
- Reading marks as read: opening the detail pushes the read position to the current maximum `seq` (`POST …/read`), and the sidebar badge drops accordingly.
- Pills: a remark pass splits `proposal:<n>[#<pattern>]` in text nodes (bare or as `[…](proposal:…)`) into `<data value="proposal:12#…">` nodes, the same technique as the channel @-pills; the component takes title and unread count from the proposal index in the company state, the index lazily loaded per organization when the page contribution exists; when the plugin is absent, the node displays as-is. The shared `MdLink` is untouched.

### Platform changes (the parts of the implementation PR that belong to the platform)

1. `WebShellSlots.pages.nav` gains `"org"`: paths relative to `/org/:projectId/:orgId/`, mounted under `OrgLayout`, the nav row appended after the six built-in entries; labels and icons are registered with the built-in renderer (`OrgProposalsPage` registers `S.nav.org.proposals` and its icon).
2. The server opens an organization gateway to plugins, `OrgGateway` (`mechanisms/organization.ts`, provided by `OrganizationModule`, exported by `CompanyModule`, types exported via `@prismshadow/penguin-server/plugin`): `companyModeEnabled()`, `organization(projectId, orgId)` (an `OrgView`: name, status, language, shared workspace, employees (id, display name, title, superior), the Project's people), `principalOf(projectId, orgId, actor)` (the same actor attribution as ticket routing), `deliverToDesk(projectId, orgId, agentId, text)` (after ensuring the desk, starts a Task as `server`, queuing when busy, returning `{ sessionId, queued }`; refused when the organization or the employee is paused), `openEmployeeSession(...)` (the ticket-session machinery minus the ticket: create a `client: "org"` session, set the title, start the first Task), `notifyProject(event)`. Apart from `deliverToDesk` reusing the desk's existing delivery path (`ensureDesk` + `startTask(..., { queueIfBusy: true })`), these merely collect `OrganizationService`'s existing methods into one interface.
3. `ServerEvent` gains a generic `{ type: "plugin"; plugin: string; data: unknown }`; plugins use it to push user-level events; the Web dispatches on `plugin`.
4. The CLI gains `penguin org proposal …`.

### Tests

- Plugin unit tests: ledger replay, paragraph correspondence (same text keeps its id), every state-machine edge and refusal, validation (three sections, file links), pending comments invisible to the author, unread counts.
- `packages/plugin-test` end to end: a real server with the plugin installed — after creating a proposal the author's desk receives a `[proposal #1]` line, the organization has no proposals channel, paragraph ids stay stable after two `publish`es, `implement` opens a `client: "org"` session, `GET /api/contributions` includes the page contribution.
- Web: the pill remark pass (bare form, link form, untouched inside code blocks), queue ordering, route mounting for `nav: "org"`.
- CLI: subcommand arguments and error pass-through.

### Landed (implementation PR)

The server's four platform changes, the code plugin `plugins/company-proposals` (ledger, document parsing, state machine, routes, page contribution; unit and end-to-end tests), the Web's proposal page / pills / contributed page in the company navigation / plugin events in the company state, `penguin org proposal`, the content plugin `plugins/agent-company-proposals`' three Skills, docs and changelog. Divergences from this document have been written back above: `publish` refuses only on `rejected`; `approve` does not require `ready` first; `implement` sends no message. Three corrections after user trials have also been written back: employees can initiate proposals themselves (the draft allowed only delegation by a person — in practice a 403); no roles — the author implements by default, the content plugin auto-installs; approval, rejection, and commenting still belong to the person alone. Two page adjustments have also been written back: comments are stored as Markdown ranges of the selected text, and Agents are given only the `⟦<id>⟧` markers; the proposal is a standalone page, not a sidebar-style two-column. Three problems found on real organizations have also been written back: the scope carries a root and four kinds, checked against the workspace at publish (the draft's scope paths mostly didn't resolve); the author must answer the changes before marking `ready` again; an archived proposals channel made every notification fail silently — undeliverable messages are now recorded as `notify_failed` events. After that, the user didn't want the proposals channel — it sent messages in the person's name and was reopened after being archived — and the plugin switched to delivering a `[proposal #<n>]` line straight to the desk, using no channels at all (the gateway's `ensureChannel` / `sendChannelMessage` were removed accordingly, replaced by `deliverToDesk`).

## Drawbacks
[drawbacks]: #drawbacks

- Yet another "person reviews Agent output" artifact, partially overlapping the ticket `review` column. The difference is granularity: a ticket reviews the result, a proposal reviews the approach; with both coexisting, the handbook must make clear when to use which.
- The ledger is a plugin-private format, unlike tickets, which can be read and edited with file tools; employees can only go through the CLI.
- Employee-to-employee exchanges about a proposal go only through `feedback`; there is no readable conversation record — the person sees the feedback in the event timeline, but not the discussion between employees.
- The CLI subcommands live in the platform; with the plugin uninstalled they are an entry point that only ever 404s.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **The ledger belongs to the plugin; the source belongs to the company.** The user explicitly did not want "a proposals folder": a proposal's home can be an issue or an RFC file; what the plugin needs is only to render it as something commentable, with unread counts. Hence the ledger records only "the copy delivered in", and the source hangs beside it as a material link. The alternative is taking GitHub issues as the truth (comments on the issue) — betting the feature on the GitHub API and tokens, which fails offline and for private repositories; or taking `rfcs/` files as the truth — comments and unread still need their own storage, effectively one more parsing layer outside the ledger.
- **Straight to the desk: no channels, and no new trigger kinds.** A channel message always has a speaker: sent in the person's name, the person sees "themselves" talking in the channel (the user explicitly rejected that); sent in an employee's name, it requires the employee to be in the channel with the channel open. Desk delivery has no speaker — it is just the desk's next input, the same path as a calendar trigger. Adding a trigger kind would touch core's `OrgTriggerKind`, while one prefixed line of plain text already tells the employee what to do.
- **No file links in the body.** The proposal is an abstraction layer for humans; once paths creep in, the reader goes off to browse the diff, and the abstraction collapses on the spot. The scope table carries the "which files" facts; the body speaks only of interfaces.
- **Comments are batched.** Comment by comment, the author is woken once per comment — one review becomes ten revisions; one batch is one revision, and the author can also make holistic trade-offs.
- **The implementation merges into dev first.** Slow human reading shouldn't hold the implementation back from being tested; the dev branch's health is maintained in batches by the test team, and findings are routed by whether the proposal is already merged — into fix tickets or change requests.
- **Renderers live in the Web build.** The platform's contract is that contributions carry data only; the pills, the sidebar badge, and the company state that the page needs all live in the Web — an iframe can't do that. The page appearing when the plugin is present and disappearing when it's gone still holds.
- **`merged` opens on a fact, not automatically.** The identity check ("the implementer or the person") leaves proposals without an implementer — for example, the batch that had a PR first and a proposal added later — waiting for someone to remember to click; whereas "the PR is merged into the default branch" is a fact GitHub can attest. Swapping the identity check for that fact lets the employee report the merge themselves once it has happened. The alternative is the plugin writing `merged` automatically when it reads an already-merged PR status: that is a write triggered by a read, where either it is unclear in whose name the entry lands, or every page open may rewrite the ledger; this design first gives the employee a road they can walk, and automation waits until it is needed.
- Do nothing: keep using channel messages as proposals — no numbers, no revisions, no passage comments, no unread.

## Prior art
[prior-art]: #prior-art

- GitHub PR review: line-by-line comments, "Start a review" to batch, "Request changes" to send once — this proposal swaps the anchor from lines to paragraphs, and the target from a diff to a description of the change.
- Rust RFCs: one number, one document, the implementation PR attached alongside, the body discussing motivation and design rather than the diff; this repository's PRFCs are exactly that form.
- This repository: tickets' `history` fact log and the `org_desk_notices` queue (record, don't wake), channel messages' jsonl and read cursors, the channel @-pill remark pass, `pages` contributions and built-in renderer registration.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **Where the CLI lives.** Plugins have no mechanism to contribute to the CLI today; `penguin org proposal` can only live in the platform CLI. Accept that, or first build a generic `penguin api <method> <path>` so Skills can call the API directly? This document takes the former, because commands inside a Skill should read well.
- **The proposals page in navigation or a sidebar list.** This document puts it in navigation (the seventh entry). The queue is already inside the page; the sidebar only needs the badge.
- **The implementation session's Workspace.** Defaults to the shared workspace root; with several proposals in flight, their branches trample one another in the same checkout. One worktree per proposal (`workspace/proposals/<n>/`)? That is left to the `proposal-implementer` Skill's rules rather than the server.
- **Landing the specs.** `02-TAXONOMY` (the proposal entry), `05-ARCHITECTURE` (the mechanisms of the company-mode section), and `06-PROTOTYPE` (the proposal page) are left to the specs PR after the implementation merges, as PRFC-0014 did.

## Future possibilities
[future-possibilities]: #future-possibilities

- Source adapters: let the ledger sync **both ways** with GitHub issues / `rfcs/` files, writing comments back to the issue.
- A discussion record between employees on a proposal (a thread per proposal) that the person can also read.
- Proposal templates defined by the handbook (the sections' names and count).
- Integration with tickets: a proposal automatically carries a parent ticket, fix tickets hang beneath it, and finance rolls costs up per proposal.
- A person's comments could also arrive from messaging channels (Feishu / Telegram).

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the design PR [#210](https://github.com/Prism-Shadow/penguin-harness-design/pull/210) draft together with the revision from PR [#233](https://github.com/Prism-Shadow/penguin-harness-design/pull/233), identical to the source file.
