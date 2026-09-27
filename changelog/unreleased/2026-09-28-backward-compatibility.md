# Deploy runs and stage states tables

- **Date:** 2026-09-28
- **Type:** refactor
- **Scope:** `server`

Migration 23 (`activity-deploy-runs`) added the `activity_deploy_runs` and
`activity_deploy_stages` tables for the [module release](2026-09-28-activity-deploy-module-release.md).
It rewrote no existing row.

## Compatibility

Migration 23 is swap-safe: a pushed platform applies it without a restart, and an older build
neither reads nor writes the new tables. Rolling it back drops both tables and loses only the
deploy history and the stage states; the log files under `PENGUIN_HOME/activity-deploy/logs`
stay on disk, unread.

The [QA deploy](2026-09-28-activity-deploy-qa.md) changed no schema:

- The stored deploy settings gained an optional `repos.mediaPublicBase`. A row saved without it
  reads the default, `{{MEDIA}}/`; nothing stored is rewritten. An older build ignores the field.
- The six new stages (`export_activity_data` to `await_activity_deploy`) are new rows in
  `activity_deploy_stages`, and a run with the selection `qa` is a new value in
  `activity_deploy_runs`. An older build skips stage rows it does not know, and returns a `qa`
  run's stored record as it is, new stage names included.

The [PROD deploy](2026-09-28-activity-deploy-prod.md) changed no schema either:

- The two PROD stages (`trigger_production_deploy`, `await_production_deploy`) are new rows in
  `activity_deploy_stages`, and a PROD run is a row with `target = 'prod'`, which the table's
  check already allowed, and the selection `prod`. An older build skips the stage rows, and
  returns a PROD run's stored record as it is when it is the activity's latest run.
- A QA run's `deploy_timed_out` error recorded no target and still reads as QA's; a PROD run's
  names `target: "prod"`.
