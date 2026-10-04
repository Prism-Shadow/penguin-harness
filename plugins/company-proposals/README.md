# Company proposals

Proposals for company mode: a person **delegates a change to an employee**, that employee writes a short, abstract, paragraph-commentable proposal, and **another employee builds it at the same time** — neither waits for the other. The person reads when they get to it, comments, sends the comments as one batch, and approves; the build is a pull request the proposal links as material.

## What you get

- **A proposal.** Numbered per organization (`#12`), with an author, an implementer, the person who delegated it, a scope (`<file, optional name pattern>` pairs — the only place a file path appears), three sections — change, purpose, one test — and materials (the PR, an issue, a branch, a ticket). Every paragraph is a place to comment.
- **Comments in batches.** A person comments as they read; nothing reaches the author until they click _Request changes_ — then the author gets one batch, resolves each comment, publishes a revision and marks the proposal ready again. Paragraphs that did not change keep their identity across revisions, and their comments with them.
- **Implementation in parallel.** The author asks for an implementer; a session opens on the proposal's text, works on a `proposal/<n>-<slug>` branch, opens a PR against the dev branch, and merges into dev as soon as it is usable — before anyone approves. What the proposal did not foresee comes back as feedback, and the author revises.
- **A discussion with the owner.** On the proposal page a person clicks Discuss: a session of the owner's Agent (the implementer, else the author) opens on the proposal — its model, its desk Workspace, the organization's approval mode — apart from its desk. When they agree, the session (or the person) sends the conclusion to the owner's desk, once.
- **A test team.** Employees with the tester skill check the dev branch in batches: a problem in a merged proposal becomes a fix ticket; a problem in one not yet approved becomes runtime feedback to its author and implementer.
- **A page, a nav entry, a link.** The proposals page (queue with unread counts on the left, the proposal on the right) sits in company mode's navigation while the plugin is installed. From the queue, and from a proposal (opened on its impl PR), a click draws the PR graph: the delivery repository's open PRs and the impl branches no PR is open on yet, stacked by ancestry, each with its proposal and the other origins' PRs on the same branch. `proposal:12` in any Markdown — a channel message, a chat reply, another proposal — renders as a capsule with the title and the unread count.

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
penguin org proposal brief <n> -m <text> | --file <f>  # rewrite the brief; the revisions stay
penguin org proposal ready <n>
penguin org proposal implement <n> --agent <id> [-m …]  # open the implementer's session
penguin org proposal material <n> add pr=<url>
penguin org proposal impl <n> --head <remote> <branch> --base <remote> <branch>  # the impl branch; no PR needed yet
penguin org proposal impl <n> <pr-url>                  # the PR opened for the head: its head must be the declared one, its base replaces the declared base
penguin org proposal diff <n> [--stat]                  # the impl branch's patch: merge base of base and head, up to head
penguin org proposal feedback <n> -m <text> [--runtime]
penguin org proposal conclude <n> -m <text>             # inside a discussion: its conclusion, to your desk
penguin org proposal comments <n> [--pending]
penguin org proposal resolve <n> <commentId> [-m …]
penguin org proposal merged <n>                         # the implementer or a person; anybody once the impl PR is merged into its default branch
penguin org proposal reject <n> --reason <text>         # any employee, as a person may: the reason and who are recorded
penguin org proposal graph                              # the PR graph, each registered deployment marked at its commit
penguin org proposal deployment add <id> [--url <url>]  # register a deployment (--url: it is a penguin server); a repeat (id, url or install id) is refused
penguin org proposal deployment ls                      # the registry: only what was registered, no server registers itself
```

An organization deploys with its own scripts. A server admin registers each one under an id, with the command it runs (an argument vector, no shell):

```text
penguin org proposal deploy-script add <id> [--description <text>] -- <command> [args...]
penguin org proposal deploy-script ls
penguin org proposal deploy-script rm <id>
penguin org proposal deploy <n> --to <id> [--dry-run] [-- <extra args...>]
```

A proposal's implementation is its **impl branch**: a head and the base it is measured against, each a `<remote, branch>` pair, where the remote is a git remote of the proposal's repository that points at GitHub (or `owner/repo` written out). Its patch is the merge base of base and head up to head — GitHub's `compare/<base>...<head>`. The proposal page, the PR graph and `deploy` read the implementation from this pair; a PR is optional and attaches later, and registering a PR is registering its head and base. On the PR graph, an impl branch with no PR claims the open PR whose head branch it is on the delivery repository; with none, the branch is a node of its own (keyed by its head branch, its tip as `ls-remote` reads it, its parent decided by ancestry like a PR's), and the node carries the PR once one is opened on the branch. An impl branch whose head is not on the delivery repository, or could not be read there, is listed apart as `unread`. An impl registered as a PR alone is read as the impl branch that PR names; its head and base are read off the PR when needed. Reporting `merged` still checks the PR's merge, so a branch-only impl needs its PR attached first.

`deploy` resolves the head of proposal `n`'s impl — its declared head branch's tip, else its impl PR's head — and runs the script on the server that holds the organization, in its shared workspace, with the extra arguments appended to the registered command. The PR graph page does the same for any node: right-click the row (or use its ellipsis) and pick a script. The script receives the head in its environment — `PENGUIN_DEPLOY_HEAD` (the head commit), `PENGUIN_DEPLOY_REPO`, `PENGUIN_DEPLOY_PR` and `PENGUIN_DEPLOY_PR_URL` (empty for an impl branch with no PR), `PENGUIN_DEPLOY_BRANCH`, `PENGUIN_DEPLOY_PROPOSAL` (empty for a PR no proposal registered), `PENGUIN_DEPLOY_ID`, `PENGUIN_DEPLOY_RUN` and `PENGUIN_DEPLOY_BY` — and does the rest: checking the commit out, building, shipping, holding its own credentials. A run succeeds when the script exits 0. One run per script at a time, stopped after an hour; runs and their output (the last MiB) are kept in memory, so a restart forgets them. The registry is `deploy-scripts.json` in the organization's directory.

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

Each organization has one SQLite store, `<root>/<project>/organizations/<org>/company.db`, shared with company-roadmaps (each plugin writes only its own tables). A proposal's header, every revision in full, its events, comments and batches, materials, impl, sessions and each person's read position are rows there; revisions, events and the other history rows are only ever appended. Where a proposal's text originally lives — a GitHub issue, an RFC file in the repository — is the company's business; the store records what was sent in. Who may do what, revision numbers, terminal states and the uniqueness of an impl are default rules in `src/guards.ts`, not constraints of the store.

The PR graph reads from the same store. A refresh probes the delivery repository with one `git ls-remote`; only when a ref moved does it read the PRs from GitHub (one GraphQL query per batch), fetch the moved refs into a blobless bare mirror under `git/<owner>/<repo>.git` in the organization directory, and compare the commits it has not compared yet there. The graph laid out from those facts is stored as a snapshot keyed by its input, so a read never waits for git or GitHub. A read probes again once the window (`graphRefreshMinutes`, 5 by default) has passed — the window doubles while nothing changes, up to 30 minutes — and registering an impl, the page's refresh button (`GET /graph?refresh=1`) and a finished deploy run refresh at once. PR statuses are cached in the store for the same five minutes and refreshed in the background.

## API

`/api/projects/:projectId/organizations/:orgId/proposals` — `GET /`, `POST /` (`{ author, brief, title? }`, a person; an employee gets 403 `roadmap_only` — its new proposals are created by [company-roadmaps](../company-roadmaps/README.md) when a roadmap item gets its second approval, through this plugin's module method `createFromRoadmap`, and they record the roadmap and the item; the same item with the same brief creates one proposal), `GET|PUT /:number` (`{ markdown }`), `PUT /:number/brief` (`{ brief }`, the author or a person), `POST /:number/ready|approve|reject|merged|implement|materials|feedback|comments|comments/request|comments/:id/resolve|read` (`reject` takes `{ reason }` from a person or any employee), `POST /:number/discussions` (a person; answers the session) and `POST /:number/discussions/:sessionId/conclude` (`{ text }`, a person or that session), `PUT /:number/impl` (`{ head?, base?, url? }`: a branch pair, a PR, or both; anybody in the organization; 400 `impl_remote_unknown`, 409 `impl_branch_taken` / `impl_pr_taken` / `impl_pr_mismatch`), `GET /:number/impl/diff` (the patch, read from GitHub; 409 `no_impl`), `GET /graph[?refresh=1]` (with a `deployments` array and `refreshing`), `GET|POST /deployments` (`{ id, url? }`; anybody in the organization; 409 `deployment_registered` on a repeat, 422 `deployment_unreachable` when the url is not read as a penguin server). Every route answers 404 while company mode is off.

A deployment is an id; a penguin server deployment also has a `url`, and its commit is read from that server's public `GET /api/install` (`installId`, `commit`, `describe`) at each graph refresh and kept in memory. A deployment without a url reports no commit. Registrations are `deployment` lines in the organization's own `deployments.jsonl`; nothing is on the registry by default.

## Development

```sh
pnpm --filter @prismshadow/penguin-server build
pnpm --filter @prismshadow/penguin-plugin-company-proposals build
pnpm --filter @prismshadow/penguin-plugin-company-proposals test
```

`test/integration.test.ts` starts the real server with the plugin installed (`@prismshadow/penguin-plugin-test`); the rest run over a gateway fake.
