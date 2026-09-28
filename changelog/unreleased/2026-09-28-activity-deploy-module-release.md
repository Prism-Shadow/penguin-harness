# Release an activity's module from the Deploy section

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

The Deploy section gained **Module release**. The project owner pressed **Release module**,
confirmed that it pushes the module's deploy branch and starts a Jenkins build, and optionally
gave a module version. Penguin then ran four stages in the module's deploy clone: it verified
the module builds, prepared the deploy branch's commit, pushed the branch and started the
Jenkins module build, and waited for the release tag that build made. Each stage showed whether
it was not run, running, done, failed or stopped, why it failed, and why it could not run yet.
A live log followed the work, **Stop** ended it, and the stage states survived a server restart.
Each stage could also be run on its own under **Run one stage**.

## Details

- `verify_module` fetched the clone's origin and put the clone back to `main` as origin had it
  (`git checkout -f main`, `git reset --hard origin/main`, `git clean -fd -e node_modules`), so
  what an earlier release left there, failed or stopped half way, never kept the next one from
  starting. It then copied
  the newest succeeded module run's module over the clone's working tree (leaving `.git` and
  `node_modules`), and ran `npm ci`, `npm run buildDebug`, `npm run lint` and
  `npm run buildRelease`. Without an assembled module it verified the clone as its repository
  held it.
- `prepare_deploy` ran `git checkout -B loom/<module-short-name>-deploy main`, wrote the package
  name `wafmodule-<short-name>` (and the version, when one was given) into `package.json` and
  `package-lock.json`, compiled `res/style.scss` with `npx --yes -p sass@1.54.0` when it existed,
  and committed as the configured git identity. Nothing to commit was not a failure. It carried the
  content `verify_module` left in the working tree, so it ran once per run of `verify_module`:
  running it again answered the blocker `previous_rerun` until `verify_module` had run again.
- `trigger_module_build` fetched the tags and noted the newest plain semver tag and the newest
  Jenkins build with the same parameters, pushed `main` when the remote lacked it, ran
  `git push --force-with-lease -u origin <deploy branch>`, and started the module build job with
  `Modules=<short-name> <deploy branch>`.
- `await_module_build` looked every 15 seconds for a newer plain semver tag than the one noted,
  and recorded it as the resolved module version. It failed when the Jenkins build failed, when
  the build succeeded without a newer tag, or when the configured build minutes passed. Builds
  numbered at or below the one noted before the trigger were never taken for the new one.
- Jenkins requests used Basic auth with the QA credentials, followed no redirect, fetched a crumb
  from `crumbIssuer/api/json` once when a 403 named the crumb or CSRF, and found a build by its
  parameters in `queue/api/json` and the job's `builds`. No error, log line or response carried
  the token.
- Added `GET /api/projects/:projectId/activities/:activityId/deploy`, answering
  `{ context, run, stages }` where each stage carried its status, finish time, what it recorded
  and a blocker code (`previous_stage`, `previous_rerun`, `run_active`, `settings_missing`, `clone_missing`,
  `clone_dirty` or `not_ready` with the readiness problem). Added `POST .../deploy`
  (`{ stage: "release" | <stage>, moduleVersion? }`, 202 with the run), `GET
.../deploy/runs/:runId/log?after=N` (`{ log: { lines, next, done }, run }`) and
  `POST .../deploy/stop`. Starting and stopping were the project owner's; reading was a member's.
- Only the canonical ref started a release (409 `deploy_not_canonical`), one deploy ran at a
  time on the server (409 `deploy_running`), and a stage whose blocker was set answered 409
  `deploy_blocked` with `detail.stage`, `detail.blocker` and the facts it named, which the page
  worded as the stage list does. Every stage needed the deploy to be ready, except for the
  changes a release leaves in the module clone (uncommitted files, commits not yet pushed, a
  branch with no upstream yet). Starting a stage set every stage after it back to pending.
- A stage that failed answered a code the page worded: `command_failed` (with the command, its
  exit code and the end of its output), `command_timed_out`, `command_missing`,
  `jenkins_failed` (with the HTTP status), `build_failed`, `no_newer_tag`, `build_timed_out`,
  `missing_input`, `interrupted` or `unexpected`.
- Runs and stage states were stored in two new tables, `activity_deploy_runs` and
  `activity_deploy_stages` (migration 23). A run the server was running when it stopped was
  marked `interrupted`. The log's last 2 000 lines were kept in memory for the one-second polls,
  and the whole log (its end bounded at 256 KB) in `PENGUIN_HOME/activity-deploy/logs/<runId>.log`.
- Stop aborted the run and killed the running program, git included, with everything it
  started. npm and npx
  ran without a prompt, their output streamed to the log, with a 20-minute limit each.
- `DeployPorts` gained `jenkinsFetch`, `runProcess`, `now` and `sleep`, which the tests replaced
  so no test ran git, npm or a request.
