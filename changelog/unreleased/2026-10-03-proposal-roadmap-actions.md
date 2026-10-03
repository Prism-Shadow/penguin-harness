# Proposal and roadmap writes are Actions, and deploys come from company modules

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`, `cli`
- **Breaking:** yes — the proposal and roadmap write routes moved to `…/actions/<key>/runs`, people and employees are treated alike, and registered deploy scripts are no longer run

[中文版](2026-10-03-proposal-roadmap-actions.zh.md)

Every write to an organization's proposals and roadmaps became an Action: a key, the subjects it acts on, a parameter schema, a guard and a run. Each run is recorded as an ActionRun, and the runs together are the organization's Activity. Company modules can now add Actions, replace guards and hook runs, and deploys became Actions such a module contributes.

## Action registry

- company-proposals gained a second module, `CompanyActionRegistry`. It declares the slot `CompanyActionRegistry.actions` and serves every write under `/api/projects/:projectId/organizations/:orgId/actions`:
  - `POST /:key/runs` and `POST /by-id/:contribution/runs` take `{ subject, params?, requestId?, via? }` and answer `{ run, result }`. The answer is 200 once the run ended, or 202 while a process it started runs.
  - `GET /[?subject=]` lists the bound Actions, with whether the caller may run each one on that subject.
  - Also added: `GET /contributions`, `GET /check`, `GET /runs` (paged by time, subject, actor and key) and `GET /runs/:id[?from=]`.
- Subjects are written `organization`, `proposal:<n>`, `comment:<n>/<id>`, `discussion:<n>/<session>`, `roadmap:<n>`, `item:<n>/<key>`, `branch:<remote>/<branch>`, `pr:<owner>/<repo>#<n>` and `target:<id>`.
- A contribution to the slot is one of four kinds:
  - `action`: a new Action;
  - `guard`: replaces an Action's guard, and is handed the default guard to build on;
  - `hook`: runs before or after an Action, and a key may end in `.*`;
  - `subject`: reads a subject's state, and its commit when it has one.
- Both plugins contribute their built-in Actions: 20 Actions from company-proposals (`proposal.*` and `target.register`), and 9 `roadmap.*` Actions from company-roadmaps.
- A company module's contributions take effect in an organization only once it binds them with the `action.bind` Action, stored in a new `action_bindings` table.
- A key answered by two bound contributions is refused with 409 `action_ambiguous` only when it is invoked. The refusal names each contribution's exact invocation.
- A run's start row is written inside its first write transaction, so the run commits with its write. Refused and failed attempts are recorded too.
- A retry with the same `requestId` answers the first run.
- `action_runs` and `action_run_ends` in `company.db` are append-only. A run a past process left unfinished is recorded `abandoned` when the store next opens.
- An Action's parameters are declared with a subset of arktype's string syntax and are checked before the run.

## Default guards

- The built-in guards stopped telling people from employees. An employee may now create a proposal, approve it, comment on it, request changes and open a discussion. Anyone in the organization may publish, rewrite the brief, mark ready, ask for an implementation, resolve, conclude a discussion, draft and establish a roadmap, adopt a proposal, rename, bind a room and reopen. The status rules and their error codes stayed.
- Only the author's own ready waits for the open requests for changes to be answered.
- A merge is reported on the word of the implementer or of whoever approved the current revision. Anyone else waits for the forge to confirm the merge.
- Read positions are kept for employees as well as people.
- A roadmap item is approved in roles the organization's binding of `roadmap.item.approve` names (`config.roles`): by default the moderator's and one other member's. A principal approves once, and the approval that fills the last role creates the proposal.
- An item that is still a brief may be linked by anyone but its own owner.

## Deploys

- `GET|POST /deploy-scripts`, `DELETE /deploy-scripts/:id`, `penguin org proposal deploy-script add|ls|rm` and the reading of `deploy-scripts.json` were removed.
- A deploy is a `deploy.<id>` Action a company module contributes, on a proposal (its impl's head), a PR or a branch. The registry resolves the commit when the run starts and refuses it with 409 `head_moved` when it is not the `expectedHead` the caller saw.
- company-proposals gained a `deploy` entry, `@prismshadow/penguin-plugin-company-proposals/deploy`, with `deployProcess`, `deployGuard`, `DEPLOY_PARAMS` and the Action model's types. A deploy keeps the `PENGUIN_DEPLOY_*` environment, the one-run-at-a-time default, the one-hour limit and the last MiB of output, which is now stored with the run.
- A finished deploy run refreshes the PR graph through a built-in after hook on `deploy.*`.

## CLI

- The `penguin org proposal` write commands kept their shape and run the matching Actions. `penguin org proposal deploy` runs `deploy.<id>` and follows its output.
- Added `penguin org action ls|run|exec|runs|check|bind`.

## Web

- The proposal and roadmap writes go through the Action routes.
- The proposal page's buttons follow each Action's guard for the caller.
- Added an Activity view to the proposals page, and the runs of one proposal or roadmap beside it.
- The PR graph's node menu lists the bound `deploy.*` Actions and follows a run's output. The "associate a deploy script" dialog was removed.
- The roadmap column shows each approval with its role.

## Compatibility

- Clients of the old write routes (`POST|PUT|PATCH|DELETE …/proposals/…` apart from `POST /:number/read`, and every roadmap write route) must call `POST …/actions/<key>/runs`. The CLI, the Web App, the roadmap page and the room sessions' commands moved with this change.
- `deploy-scripts.json` stays on disk but is no longer read. To deploy again, install a company module that contributes `deploy.<id>` Actions and bind them in the organization (`penguin org action bind <contribution> --on`).
- Restrictions that relied on telling people from employees no longer apply. A company that wants them back replaces the guards with a company module.
