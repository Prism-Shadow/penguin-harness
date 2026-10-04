# Company proposals

Proposals for company mode: a person **delegates a change to an employee**, that employee writes a short, abstract, paragraph-commentable proposal, and **another employee builds it at the same time** — neither waits for the other. The person reads when they get to it, comments, sends the comments as one batch, and approves; the build is a pull request the proposal links as material.

## What you get

- **Proposals come from roadmaps.** A new proposal is created when a roadmap item's brief gets its last approval: [company-roadmaps](../company-roadmaps/README.md) creates it through this plugin's `createFromRoadmap`, with the item's owner as its author.
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
penguin org proposal merged <n>                         # the implementer or whoever approved the revision; anybody once the impl PR is merged into its default branch
penguin org proposal reject <n> --reason <text>         # the reason and who are recorded
penguin org proposal graph                              # the PR graph, each registered deployment marked at its commit
penguin org proposal deployment add <id> [--url <url>]  # register a deployment (--url: it is a penguin server); a repeat (id, url or install id) is refused
penguin org proposal deployment ls                      # the registry: only what was registered, no server registers itself
```

Every write above is an **Action** (see below); `penguin org action` reaches them all:

```text
penguin org action ls [--subject <s>] [--all]           # the Actions in force (--all: every contribution, built in or a workflow's)
penguin org action run <key> <subject> [--param k=v …]  # e.g. run proposal.approve proposal:12
penguin org action exec <contribution> <subject> …      # one contribution exactly, when a key is ambiguous
penguin org action runs [--subject <s>] [--by <p>] [--key <k>]   # the Activity, newest first
penguin org action check                                # the keys two contributions of one standing answer
penguin org workflow ls                                 # the company workflows: the revision serving, whether the files load
penguin org workflow put <id> <dir> [--keep]            # write a local directory as company workflow <id> and load it
penguin org workflow reload|rm|history <id>             # load again after an edit in place / delete / its versions
penguin org workflow rollback <id> <revision>           # restore a recorded version and load it
penguin org proposal deploy <n> --to <id> [--head <sha>] [-- <extra args...>]   # runs deploy.<id> on proposal n's impl head
```

A proposal's implementation is its **impl branch**: a head and the base it is measured against, each a `<remote, branch>` pair, where the remote is a git remote of the proposal's repository that points at GitHub (or `owner/repo` written out). Its patch is the merge base of base and head up to head — GitHub's `compare/<base>...<head>`. The proposal page, the PR graph and `deploy` read the implementation from this pair; a PR is optional and attaches later, and registering a PR is registering its head and base. On the PR graph, an impl branch with no PR claims the open PR whose head branch it is on the delivery repository; with none, the branch is a node of its own (keyed by its head branch, its tip as `ls-remote` reads it, its parent decided by ancestry like a PR's), and the node carries the PR once one is opened on the branch. An impl branch whose head is not on the delivery repository, or could not be read there, is listed apart as `unread`. An impl registered as a PR alone is read as the impl branch that PR names; its head and base are read off the PR when needed. Reporting `merged` still checks the PR's merge, so a branch-only impl needs its PR attached first.

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

## Actions

Every write to an organization's proposals and roadmaps — publishing a revision, ready, request changes, approve, reject, merged, an item's approval, establishing a roadmap, a deploy, and the rest — is an Action: a key (`proposal.approve`), the subjects it acts on, a parameter schema, a guard and a run. The plugin's `CompanyActionRegistry` module declares the slot `CompanyActionRegistry.actions`, runs every Action through `POST …/actions/:key/runs`, and records each run — succeeded, refused or failed — as an ActionRun; that timeline is the **Activity** (the proposals page's Activity view, `penguin org action runs`).

The built-in Actions (this plugin's `proposal.*` and `target.register`, company-roadmaps' `roadmap.*`) carry default guards that do not tell a person from an employee: whatever a person may do, an employee may do, approvals included. Their process rules — a revision is the current one plus one, an approval covers one revision, merged and rejected are final, one impl per PR and per head, a sent comment is frozen — are defaults too; the store guarantees only the data and an append-only history.

A **company workflow** is how an organization customizes its process: the same thing as an Agent's workflow, scoped to the organization — a package under `<root>/<project>/organizations/<org>/workflows/<id>/` (`package.json#penguin.modules`, a root module named `Workflow`, `index.ts` in TypeScript), compiled, checked and booted as a module tree of its own by the server's workflow loader, the one an Agent's workflows go through. Its tree is given `Host` (`CompanyHost`: the organization, its shared workspace, the deploy helper) and the slot `CompanyActionRegistry.actions`, to which it contributes a new Action, a `guard` replacing an Action's (it is handed the guard it replaces), or a `hook` before or after one. Contributing is taking effect: once it loads, its contributions are in force in that organization and nowhere else. A company workflow's `action` or `guard` takes the place of the built-in one on its key; hooks run built-in ones first, then the workflows' by workflow id and contribution id. Two company workflows answering one key with an `action`, or with a `guard`, are reported only when the key is invoked (409 `action_ambiguous`, naming each `penguin org action exec <contribution>`, with no run recorded); `penguin org action check` lists them all. Run by its id, an `action` has its guard resolved by key as usual, and a `guard` judges its key's Action alone. Server-wide plugins contribute only built-in Actions.

Writing a company workflow is itself an Action on `workflow:<id>`: `workflow.write` (`{ files: { <path>: <content> | null }, replace? }`), `workflow.remove`, `workflow.rollback` (`{ revision }`) and `workflow.reload` (after an edit in place on the server). Each loads the workflow and its run's result says whether it loaded and why not, so the Activity shows who changed the process when, and whether it took effect. A version that does not compile or check keeps the previous one in force; every version that loaded is kept (the last 20) under `workflows-history/<id>/`. A company workflow cannot replace or hook the `workflow.*` Actions — such a contribution is left out — so an organization cannot lock itself out of changing its workflows. The code runs in the server process, as an Agent's workflow does; any member may write one until a permission system refines that.

**Deploys** are Actions a company workflow contributes, keyed `deploy.<id>`, on a proposal (its impl's head: the declared head branch's tip, else the impl PR's head), a PR or a branch. The registry resolves the subject's commit when the run starts and refuses it when it is not the `expectedHead` the caller saw. The run starts its process with `host.deploy(ctx.runId, argv)` — the workflow takes its types (the Action model) from this package's `deploy` entry, `@prismshadow/penguin-plugin-company-proposals/deploy`, as types only — in the organization's shared workspace, with the run's extra `args` appended, with the commit in its environment — `PENGUIN_DEPLOY_HEAD` (the head commit), `PENGUIN_DEPLOY_REPO`, `PENGUIN_DEPLOY_PR` and `PENGUIN_DEPLOY_PR_URL` (empty for a head with no PR), `PENGUIN_DEPLOY_BRANCH`, `PENGUIN_DEPLOY_PROPOSAL` (empty for a head no proposal registered), `PENGUIN_DEPLOY_ID`, `PENGUIN_DEPLOY_RUN` and `PENGUIN_DEPLOY_BY`. A run succeeds when the process exits 0. One run of a deploy at a time by default, stopped after an hour; the output's last MiB is kept with the run. The PR graph page lists the organization's `deploy.*` Actions in a node's menu and follows the run's output.

## Where things live

Each organization has one SQLite store, `<root>/<project>/organizations/<org>/company.db`, shared with company-roadmaps (each plugin writes only its own tables). A proposal's header, every revision in full, its events, comments and batches, materials, impl, sessions and each reader's read position (a person's or an employee's) are rows there, beside the ActionRuns; revisions, events, runs and the other history rows are only ever appended. Where a proposal's text originally lives — a GitHub issue, an RFC file in the repository — is the company's business; the store records what was sent in. Who may do what, revision numbers, terminal states and the uniqueness of an impl are the default guards and rules in `src/guards.ts`, not constraints of the store.

The PR graph reads from the same store. A refresh probes the delivery repository with one `git ls-remote`; only when a ref moved does it read the PRs from GitHub (one GraphQL query per batch), fetch the moved refs into a blobless bare mirror under `git/<owner>/<repo>.git` in the organization directory, and compare the commits it has not compared yet there. The graph laid out from those facts is stored as a snapshot keyed by its input, so a read never waits for git or GitHub. A read probes again once the window (`graphRefreshMinutes`, 5 by default) has passed — the window doubles while nothing changes, up to 30 minutes — and registering an impl, the page's refresh button (`GET /graph?refresh=1`) and a finished deploy run refresh at once. PR statuses are cached in the store for the same five minutes and refreshed in the background.

## API

`/api/projects/:projectId/organizations/:orgId/proposals` serves the reads: `GET /`, `GET /:number`, `GET /:number/revisions[/:rev]`, `GET /:number/file?path=`, `GET /:number/comments[?pending=1]`, `GET /:number/impl/diff` (the patch, read from GitHub; 409 `no_impl`), `GET /test-groups`, `GET /graph[?refresh=1]` (with a `deployments` array and `refreshing`), `GET /deployments`, and `POST /:number/read` (`{ upTo }`, the caller's read position — not an Action).

`/api/projects/:projectId/organizations/:orgId/actions` carries every write: `POST /:key/runs` and `POST /by-id/:contribution/runs` (`{ subject, params?, requestId?, via? }` → `{ run, result }`, 200 once ended, 202 while a process runs; a refusal or a failure answers its status with `{ error: { code, message, runId } }` — a failure 500 unless it carried a 5xx of its own; an ambiguous key answers 409 with `contributions` instead of `runId`), `GET /[?subject=]` (the Actions in force, with whether the caller may run each on that subject now), `GET /contributions`, `GET /check`, `GET /runs[?subject=&by=&key=&before=&limit=]` and `GET /runs/:id[?from=]`. Subjects are written `organization`, `proposal:<n>`, `comment:<n>/<id>`, `discussion:<n>/<session>`, `roadmap:<n>`, `item:<n>/<key>`, `branch:<remote>/<branch>`, `pr:<owner>/<repo>#<n>` (or `pr:<n>`), `target:<id>` and `workflow:<id>`. `/api/projects/:projectId/organizations/:orgId/workflows` reads the company workflows: `GET /`, `GET /:id` (its state: its contributions in force, and any the registry left out and why — as a `workflow.*` run's result gives it), `GET /:id/history` and `GET /:id/files/<path>`. An employee's new proposal still comes from [company-roadmaps](../company-roadmaps/README.md) when a roadmap item gets its last approval, through this plugin's module method `createFromRoadmap`; the same item with the same brief creates one proposal. Every route answers 404 while company mode is off.

A deployment is an id; a penguin server deployment also has a `url`, and its commit is read from that server's public `GET /api/install` (`installId`, `commit`, `describe`) at each graph refresh and kept in memory. A deployment without a url reports no commit. Registrations are `deployment` lines in the organization's own `deployments.jsonl`; nothing is on the registry by default.

## Development

```sh
pnpm --filter @prismshadow/penguin-server build
pnpm --filter @prismshadow/penguin-plugin-company-proposals build
pnpm --filter @prismshadow/penguin-plugin-company-proposals test
```

`test/integration.test.ts` starts the real server with the plugin installed (`@prismshadow/penguin-plugin-test`); the rest run over a gateway fake.
