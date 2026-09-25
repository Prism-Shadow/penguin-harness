# Company proposals

Proposals for company mode: a person **delegates a change to an employee**, that employee writes a short, abstract, paragraph-commentable proposal, and **another employee builds it at the same time** — neither waits for the other. The person reads when they get to it, comments, sends the comments as one batch, and approves; the build is a pull request the proposal links as material.

## What you get

- **A proposal.** Numbered per organization (`#12`), with an author, an implementer, the person who delegated it, a scope (`<file, optional name pattern>` pairs — the only place a file path appears), three sections — change, purpose, one test — and materials (the PR, an issue, a branch, a ticket). Every paragraph is a place to comment.
- **Comments in batches.** A person comments as they read; nothing reaches the author until they click _Request changes_ — then the author gets one batch, resolves each comment, publishes a revision and marks the proposal ready again. Paragraphs that did not change keep their identity across revisions, and their comments with them.
- **Implementation in parallel.** The author asks for an implementer; a session opens on the proposal's text, works on a `proposal/<n>-<slug>` branch, opens a PR against the dev branch, and merges into dev as soon as it is usable — before anyone approves. What the proposal did not foresee comes back as feedback, and the author revises.
- **A test team.** Employees with the tester skill check the dev branch in batches: a problem in a merged proposal becomes a fix ticket; a problem in one not yet approved becomes runtime feedback to its author and implementer.
- **A page, a nav entry, a link.** The proposals page (queue with unread counts on the left, the proposal on the right) sits in company mode's navigation while the plugin is installed. `proposal:12` in any Markdown — a channel message, a chat reply, another proposal — renders as a capsule with the title and the unread count.

Employees are driven the one way company mode allows: a message in the organization's `proposals` channel, in the delegating person's name, @-mentioning the employee it is for. No new trigger kind, no second drive chain.

## Install

Two packages, off by default:

- this one, the code: on a Project's Plugins page add `@prismshadow/penguin-plugin-company-proposals`, or list it in the Project's `.project_config.toml`:

  ```toml
  plugins = ["@prismshadow/penguin-plugin-company-proposals"]
  ```

- `agent-company-proposals`, the skills (`proposal-author`, `proposal-implementer`, `proposal-tester`): install it from the plugin library onto the employees that take those roles.

## Use

For a person: company mode → **Proposals** → _New proposal_ (pick the author, write the delegation). Then read, comment, _Request changes_, _Approve_.

For an employee, `penguin org proposal …` inside its session:

```text
penguin org proposal ls | show <n>
penguin org proposal publish <n> --file <markdown>     # a revision
penguin org proposal ready <n>
penguin org proposal implement <n> --agent <id> [-m …]  # open the implementer's session
penguin org proposal material <n> add pr=<url>
penguin org proposal feedback <n> -m <text> [--runtime]
penguin org proposal comments <n> [--pending]
penguin org proposal resolve <n> <commentId> [-m …]
penguin org proposal merged <n>
```

The document a revision sends:

```markdown
---
title: Ticket notices reach an employee in one batch
scope:
  - file: packages/server/src/runtime/organization/reconcile.ts
    name: "notifyTicket|reconcileCalendar"
---

## Change

`notifyTicket` writes `org_desk_notices` instead of messaging the desk; `reconcileCalendar` appends the digest before a sweep.

## Purpose

Every ticket change woke the desk; one sweep should handle them all.

## Test

`reconcile.test.ts` "a blocked ticket reaches its owner at the next sweep, once".
```

The three sections may be `改动` / `目的` / `测试` instead. A body that links to a file is refused: name the interface, put the file in the scope.

## Where things live

The ledger is one append-only file per organization, `<root>/<project>/organizations/<org>/proposals.jsonl`, written only by the server. Where a proposal's text originally lives — a GitHub issue, an RFC file in the repository — is the company's business; the ledger records what was sent in.

## API

`/api/projects/:projectId/organizations/:orgId/proposals` — `GET /`, `POST /` (`{ author, brief, title? }`), `GET|PUT /:number` (`{ markdown }`), `POST /:number/ready|approve|reject|merged|implement|materials|feedback|comments|comments/request|comments/:id/resolve|read`. Every route answers 404 while company mode is off.

## Development

```sh
pnpm --filter @prismshadow/penguin-server build
pnpm --filter @prismshadow/penguin-plugin-company-proposals build
pnpm --filter @prismshadow/penguin-plugin-company-proposals test
```

`test/integration.test.ts` starts the real server with the plugin installed (`@prismshadow/penguin-plugin-test`); the rest run over a gateway fake.
