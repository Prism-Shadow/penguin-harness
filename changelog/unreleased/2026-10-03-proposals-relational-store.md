# Proposals and roadmaps are stored in one SQLite file per organization

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`
- **Breaking:** yes — the new store starts empty: proposals, roadmaps, read positions and registered deployments written before it are not read

[中文版](2026-10-03-proposals-relational-store.zh.md)

The company-proposals and company-roadmaps plugins stopped replaying append-only JSON-lines ledgers. Each organization got one SQLite store, `company.db` in its directory (`node:sqlite`, WAL), shared by both plugins, each writing only its own tables. The PR graph and the PR statuses moved into the same store, and the graph stopped asking GitHub for every comparison. Routes, response shapes, error codes and the CLI stayed as they were, apart from the graph's refresh described below.

## Storage

- A proposal's header, every revision in full, its events, comments and request-for-changes batches, materials, impl, implementation and discussion sessions, and each person's read position became rows of `proposal_*` tables; a roadmap's header (with the current record and body), items, delegations, approvals, room sessions, drafts and events became rows of `roadmap*` tables. Reads became indexed queries; nothing is folded at startup, and the channel claim answers with one query on a read-only connection.
- Revisions, proposal and roadmap events, drafts and approvals are append-only: triggers refuse to update or delete them. The store checks keys, foreign keys, types and NOT NULL; the tables are created at startup with `IF NOT EXISTS`, with no migration runner.
- A person's read positions moved from `server_settings` into the store.
- Deployment registrations moved to their own append-only `deployments.jsonl` in the organization directory, with the same line shape; `deploy-scripts.json` was unchanged.
- The ledger modules of both plugins were deleted with their folding code.

## Rules

- The checks that were written into the two services — who may do what, revision numbers, terminal states, what an approval covers, one impl per PR and per head, comments frozen once sent — became default rules in each plugin's `guards.ts`, called inside the write transaction, with the same error codes. The rules that tell a person from an employee were kept. `ServiceDeps.rules` replaces any of them.
- A publish whose revision number is no longer the next one (another publish landed in between) is refused with 409 `revision_conflict`.
- `createFromRoadmap` became idempotent: the same roadmap item with the same brief answers the proposal it created before. A roadmap item's second approval, its delegation and its link to the proposal are written in one transaction; an approval is kept with the hash of the brief it was given on and counts only while that brief stands.

## PR graph and PR status

- The graph is read from a stored snapshot keyed by its input; a read never runs git or reaches the network. A refresh probes the delivery repository with one `git ls-remote`; only when a ref moved does it read the PRs through `gh api graphql` in batches, fetch the moved refs into a blobless bare mirror (`git/<owner>/<repo>.git` in the organization directory) and compute the missing comparisons there.
- The probe window is 5 minutes (the new `graphRefreshMinutes` setting) and doubles with each quiet probe up to 30 minutes; with nobody reading the graph nothing is probed. Registering an impl, the page's refresh button (`GET …/proposals/graph?refresh=1`, which waits for the refresh) and a finished deploy run refresh at once. One refresher runs per organization, with a lease in the store. The graph can be up to one probe window behind the repository, and the response gained `refreshing`.
- Deployments' servers are probed at each refresh instead of at every graph read; until the first refresh after a restart a deployment's commit reads as not probed yet.
- PR statuses are cached in the store for 5 minutes and read in one background batch; reading a proposal no longer waits for `gh`. Reporting `merged` still asks the forge at once and writes the answer back.

## Compatibility

Nothing written before this change is read: `proposals.jsonl` and `roadmaps.jsonl` (and the shapes the [earlier compatibility entries](2026-10-03-backward-compatibility-impl-branch.md) described for them), the `company-proposals:reads:*` keys in `server_settings`, and the `deployment` lines in `proposals.jsonl`. An organization's proposals, roadmaps, read positions and registered deployments start empty. The old files are left on disk untouched; there is no import. Deployments are registered again with `penguin org proposal deployment add`.
