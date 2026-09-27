# Deploy settings, deploy clones and a Deploy section that says what a deploy still needs

- **Date:** 2026-09-27
- **Type:** feature
- **Scope:** `server`, `web`

Added **System settings > Deploy**, where an admin filled in where activities deploy to: the
Jenkins for QA and PROD (address, user, token, tier, environment, framework version), the QA
activity address, the module build and activity deploy job names, the activity-data and media
repositories, the git identity for the deploy's commits, and how long builds and deploys are
waited for. Each Jenkins had **Test connection**. Added a **Deploy** section to the activity
studio, below Generation History and open once the activity had a module. It listed each check a
deploy depends on with its state in words, listed everything still missing as sentences, and
offered **Prepare clones** and **Check remote** to the project owner. Nothing in this change
deployed anything.

## Details

- Added `GET` and `PUT /api/admin/activity-deploy/settings` and
  `POST /api/admin/activity-deploy/settings/test/:target` (`qa` or `prod`), admin only
  (403 `admin_required`). The settings were stored in `server_settings` under `activityDeploy`;
  the two Jenkins tokens were written to `PENGUIN_HOME/secrets/activity-deploy.json` with
  `writeSecretFile` (0600) and answered only as `{ set: boolean }`. A token left empty kept the
  saved one and `null` cleared it. Addresses had to be `https:` (or `http:` on localhost), remotes
  SSH or https without a password, framework versions a version number, and a refused field
  answered 400 `invalid_deploy_setting` with `detail.field` and `detail.reason` (a code such as
  `https_required`, `password_in_remote` or `not_email`, which the page worded under the field)
  and stored nothing. Job names defaulted
  to "Build WAF Modules" and "WAF Activity Deploy", the tiers to `qa` and `prod`, the environments
  to `loom` and `DEFAULT`, the activity-data remote to the one Loom deployed to, and both waits to
  30 minutes.
- The connection test made one GET to `<jenkins>/api/json` with Basic auth from the saved
  credentials, followed no redirect, and answered `{ test: { ok, status } }` (status 0 when
  nothing answered).
- Added `GET /api/projects/:projectId/activities/:activityId/deploy/context`, answering
  `{ context: { ready, problems, remoteChecked, module, activityData, media, branches,
  branchState } }`. Problems were codes: `settings_missing` (with the field),
  `module_remote_missing`, `module_remote_invalid`, `clone_missing`, `clone_dirty`,
  `clone_ahead`, `clone_remote_mismatch`, `clone_unknown` (git could not say whether a clone was
  clean, how far it was ahead, whether main was there, or which folders the media clone checked
  out), `remote_unreachable` (on Check remote), `media_path_missing` (the shared media clone did
  not check out this product's `media/loom/<pc>`), `branch_missing` (main, locally or on the
  remote), `not_canonical`, `no_module`, `layout_unsupported` (only `mainOnly` deploys; a
  specification naming no layout counted as `mainOnly`) and `git_unavailable`. Anything git
  could not answer counted as not ready. The module's remote came
  from `repository` in the checkout's `modules/<folder>/package.json`, else the newest assembled
  module's; it had to be an SSH or https remote without a password, like the settings' remotes.
  The deploy branches kept Loom's names (`loom/<module-short-name>-deploy`,
  `loom/<pc>-activity-data`) and were reported, not required. `?checkRemote=1` asked the remote
  with `git ls-remote` and was the project owner's.
- Added `POST .../deploy/clones` (project owner), which cloned whichever of the module, the
  activity data and the media were missing into `PENGUIN_HOME/activity-deploy/repos/`
  (`modules/<moduleFolder>`, `activity-data`, `media`). The media clone was partial and sparse
  (`--filter=blob:none --sparse`, sparse path `media/loom/<pc>`). A clone already there with the
  right origin was left alone (the media clone gained this product's sparse path when it lacked
  it), a path holding anything else answered 409
  `deploy_clone_path_taken` and was not touched, and a clone path inside the WAF checkout was
  refused. A failed clone answered 502 `deploy_clone_failed` with `detail.repo`, `detail.reason`
  (`timed_out` or `git_failed`) and `detail.output` (the end of git's output). git ran with no shell, `GIT_TERMINAL_PROMPT=0` and `ssh -o BatchMode=yes`, using the
  host's own SSH keys.
- Added the kernel service `ActivityDeploys` (`settings`, `saveSettings`, `testConnection`,
  `context`, `prepareClones`) and the ports `DeployPorts` (`runGit`, `getJenkins`), which the
  tests replaced so no test reached git, Jenkins or a network.
