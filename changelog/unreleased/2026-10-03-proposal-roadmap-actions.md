# Proposal and roadmap writes are Actions, customized by company workflows, and deploys come from them

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`, `cli`
- **Breaking:** yes — the proposal and roadmap write routes moved to `…/actions/<key>/runs`, people and employees are treated alike, and registered deploy scripts are no longer run

[中文版](2026-10-03-proposal-roadmap-actions.zh.md)

Every write to an organization's proposals and roadmaps became an Action: a key, the subjects it acts on, a parameter schema, a guard and a run. Each run is recorded as an ActionRun, and the runs together are the organization's Activity. An organization's company workflows can now add Actions, replace guards and hook runs, and deploys became Actions such a workflow contributes.

## Action registry

- company-proposals gained a second module, `CompanyActionRegistry`. It declares the slot `CompanyActionRegistry.actions` and serves every write under `/api/projects/:projectId/organizations/:orgId/actions`:
  - `POST /:key/runs` and `POST /by-id/:contribution/runs` take `{ subject, params?, requestId?, via? }` and answer `{ run, result }`. The answer is 200 once the run ended, or 202 while a process it started runs.
  - `GET /[?subject=]` lists the Actions in force, with whether the caller may run each one on that subject.
  - Also added: `GET /contributions` (each with its company workflow, and whether one replaces it), `GET /check`, `GET /runs` (paged by time, subject, actor and key) and `GET /runs/:id[?from=]`.
- Subjects are written `organization`, `proposal:<n>`, `comment:<n>/<id>`, `discussion:<n>/<session>`, `roadmap:<n>`, `item:<n>/<key>`, `branch:<remote>/<branch>`, `pr:<owner>/<repo>#<n>`, `target:<id>` and `workflow:<id>`.
- A contribution to the slot is one of four kinds:
  - `action`: a new Action;
  - `guard`: replaces an Action's guard, and is handed the default guard to build on;
  - `hook`: runs before or after an Action, and a key may end in `.*`;
  - `subject`: reads a subject's state, and its commit when it has one.
- Both plugins contribute their built-in Actions: 20 Actions from company-proposals (`proposal.*` and `target.register`), and 10 `roadmap.*` Actions from company-roadmaps.
- A key answered by two contributions of the same standing (two company workflows', or two built-in ones) is refused with 409 `action_ambiguous` only when it is invoked, in the same shape for two actions and for two guards. The refusal names each contribution's exact invocation, and is not recorded as a run. Run by its id, an `action` contribution has its guard resolved by key as usual; a `guard` contribution runs its key's Action, judged by that guard alone.
- A run's start row is written inside its first write transaction, so the run commits with its write. Refused and failed attempts are recorded too. A domain error with a 4xx status that a run throws is recorded `refused` with its status and code; anything else a run throws is `failed`, answered with its own status and code when that status is a 5xx (502 `branch_unreadable`), else 500.
- A retry with the same `requestId` answers the first run.
- `action_runs` and `action_run_ends` in `company.db` are append-only. A run a past process left unfinished is recorded `abandoned` when the store next opens.
- An Action's parameters are declared with a subset of arktype's string syntax and are checked before the run.

## Company workflows

- A company workflow is an Agent's workflow scoped to an organization: a package under `<org dir>/workflows/<id>/`, loaded by the same loader. Its tree is given `Host` (`CompanyHost`: the organization, its shared workspace and the deploy helper) and the slot `CompanyActionRegistry.actions`, and its root `Workflow` need not provide `WorkflowMain`.
- Its contributions take effect in its organization as soon as it loads, with no further step. Its `action` or `guard` takes the place of the built-in one on the same key; a replacing guard is handed the one below it. Hooks run built-in ones first, then the company workflows' by workflow id and contribution id.
- It is written through the Actions `workflow.write`, `workflow.remove`, `workflow.rollback` and `workflow.reload` on `workflow:<id>`; each run's result says whether the workflow loaded and why not, and lists the contributions left out with their reasons, apart from those in force. A version that does not load keeps the previous one in force. A company workflow cannot replace or hook `workflow.*`; such a contribution is left out.
- `GET …/organizations/:orgId/workflows[/:id[/files/<path>|/history]]` reads them.
- Server-wide plugins contribute only built-in Actions.
- The server's workflow loading — compile, interface check, tree check, revision by content, history and rollback — moved into a shared loader (`packages/server/src/workflows/loader.ts`), offered to plugins as `WorkflowLoader` (exported by `WorkflowsModule`). Agent workflows load through it unchanged.

## Default guards

- The built-in guards stopped telling people from employees. An employee may now create a proposal, approve it, comment on it, request changes and open a discussion. Anyone in the organization may publish, rewrite the brief, mark ready, ask for an implementation, resolve, conclude a discussion, draft and establish a roadmap, adopt a proposal, rename, bind a room and reopen. The status rules and their error codes stayed.
- Only the author's own ready waits for the open requests for changes to be answered.
- A merge is reported on the word of the implementer or of whoever approved the current revision. Anyone else waits for the forge to confirm the merge.
- Read positions are kept for employees as well as people.
- A roadmap item is approved by default in the moderator's role and one other member's. A company workflow that replaces the guard of `roadmap.item.approve` sets other roles by handing them to the default (`withApprovalRoles` in company-roadmaps). A principal approves once, and the approval that fills the last role creates the proposal.
- An item that is still a brief may be linked by anyone but its own owner.

## Roadmap members

- Added `roadmap.members` on `roadmap:<n>`, with `{ employees, moderator }`: it replaces the roadmap's members and names its moderator. `employees` is a non-empty list of distinct current employees (400 `bad_request`, or `not_an_employee` for one that is not or has left), and `moderator` is one of them (400 `moderator_not_member`). A member who left the organization stays a member until this Action removes it.
- Each run appends a `members` event whose note records the members and moderator before and after. The moderator it names is stored in the new nullable column `roadmaps.moderator`. While that column is null — on every roadmap never changed this way — the moderator is derived as before (see [backward compatibility](2026-10-04-backward-compatibility-notify-actions.md)).
- The `moderator` approval of an item is taken only from the moderator in force; approvals given before a change stay.
- When the roadmap has a room, the employees added join its channel and the ones removed leave it, each a system line in the channel; a room that cannot follow refuses the run. While the roadmap is discussing, a new member gets a room session as at the opening and is told through `notify.roadmap.room_joined`, and a removed member's room session is closed. In any other status only the channel changes.
- Its default guard lets a person and the roadmap's current moderator run it and refuses any other employee (403 `not_moderator`).
- The server's `OrgGateway` gained `changeRoomMembers`: employees into and out of a channel, for the work that owns it, people untouched.

## Deploys

- `GET|POST /deploy-scripts`, `DELETE /deploy-scripts/:id`, `penguin org proposal deploy-script add|ls|rm` and the reading of `deploy-scripts.json` were removed.
- A deploy is a `deploy.<id>` Action a company workflow contributes, on a proposal (its impl's head), a PR or a branch. The registry resolves the commit when the run starts and refuses it with 409 `head_moved` when it is not the `expectedHead` the caller saw.
- A company workflow's deploy runs its process with `CompanyHost.deploy(runId, argv)`, and takes the Action model's types from company-proposals' `deploy` entry, `@prismshadow/penguin-plugin-company-proposals/deploy`. A deploy keeps the `PENGUIN_DEPLOY_*` environment, the one-run-at-a-time default, the one-hour limit and the last MiB of output, which is now stored with the run.
- A finished deploy run refreshes the PR graph through a built-in after hook on `deploy.*`.
- Deleting an organization stops its Action runs first: each process a run started — a deploy's among them — gets SIGTERM, then SIGKILL after 10 s, and the run is recorded `failed`; then the registry closes its `company.db` connection and disposes the organization's company workflow trees, and only then does the proposal service close its own. A run an instance before a hot update started is stopped too. The deploy-script part of [the organization delete](2026-10-03-proposals-relational-store.md) went with the deploy scripts.

## Notices

- Every line the proposal and roadmap writes tell an employee became a built-in notify Action, one key each: `notify.proposal.created`, `notify.proposal.approved`, `notify.proposal.rejected`, `notify.proposal.changes_requested`, `notify.proposal.revised_after_approval`, `notify.proposal.feedback`, `notify.proposal.brief_edited`, `notify.proposal.discussion_concluded`, `notify.roadmap.room_joined` (each opening employee's desk: its room and room session), `notify.roadmap.derived` (a derived roadmap's moderator: its room is open, or to open one), `notify.roadmap.approval_requested` (the moderator's room session), `notify.roadmap.item_approved`, `notify.roadmap.base_linked` and `notify.roadmap.reopened` (every open room session of a reopened roadmap). The subject is the write's — `proposal:<n>`, `discussion:<n>/<session>`, `roadmap:<n>` or `item:<n>/<key>` — except `notify.roadmap.derived`, whose subject is the derived roadmap.
- A write runs its notice by key once its write committed, through the run's `act.notify`, as the same caller. The notice is recorded as an ActionRun with `via: "notify"` (a new value of `ActionRunVia`), the sending run's id as its `runId` parameter, and the recipients (`to`) and the line (`text`) as its other parameters.
- The built-in notices deliver the same lines to the same desks as before, and record `notify_failed` and answer a hint for a desk that cannot take one. A discussion's conclusion still goes out before it is recorded, and a conclusion that did not reach the desk still leaves the discussion open.
- A company workflow's `action` on a notify key replaces the built-in one, and its guard and hooks apply as for any Action. A notice that is refused or fails never fails the write: it is listed in the write's `hookErrors` and answered as a hint.
- A `notify.*` Action runs only as a write's notice: run on its own it is refused with 403 `notify_direct`, and the Action listing marks it so.
- The web Activity labels a notice's run "as a notice"; its hook error line reads "After hooks or notices failed". `action_runs` in an existing `company.db` is widened once to accept `via = 'notify'` (see [backward compatibility](2026-10-04-backward-compatibility-notify-actions.md)).
- A derived roadmap's delegation records `delivered` as its notice answered: a replacement that lists nothing in `delivered` records it undelivered. A reopening starts every room session's relay depth over but the ones its notice reports failed, whether or not a replacement told them.
- The room relay — what a member says in the room, passed to the other room sessions — is the discussion itself, not a notice. A test fails on a desk delivery or room-session line anywhere else in either plugin than the built-in notices and the relay.

## CLI

- The `penguin org proposal` write commands kept their shape and run the matching Actions. `penguin org proposal deploy` runs `deploy.<id>` and follows its output.
- Added `penguin org action ls|run|exec|runs|check` and `penguin org workflow ls|put|rm|reload|history|rollback` (`put <id> <dir>` writes a local directory as the workflow).

## Web

- The proposal and roadmap writes go through the Action routes.
- The proposal page's buttons follow each Action's guard for the caller; under the buttons, each one a guard refuses says why (the guard's message and code), as the button's description.
- Added an Activity view to the proposals page, and the runs of one proposal or roadmap beside it.
- The PR graph's node menu lists the organization's `deploy.*` Actions and follows a run's output. The "associate a deploy script" dialog was removed.
- The roadmap column shows each approval with its role.

## Compatibility

- Clients of the old write routes (`POST|PUT|PATCH|DELETE …/proposals/…` apart from `POST /:number/read`, and every roadmap write route) must call `POST …/actions/<key>/runs`. The CLI, the Web App, the roadmap page and the room sessions' commands moved with this change.
- `deploy-scripts.json` stays on disk but is no longer read. To deploy again, write a company workflow that contributes `deploy.<id>` Actions into the organization (`penguin org workflow put <id> <dir>`).
- Restrictions that relied on telling people from employees no longer apply. A company that wants them back replaces the guards with a company workflow.
