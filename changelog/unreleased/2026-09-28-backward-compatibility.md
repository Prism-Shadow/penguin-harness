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

The [automatic versions, deployed markers and module builds](2026-09-28-activity-versions-deployed-builds.md)
changed no schema either:

- `draft.json` gained an optional `pinnedModuleRunId`, which is not part of the draft's
  revision, so every draft keeps its revision, pinned or not. An older build ignores the field
  and plays the newest build.
- The deployed markers and `module_run_id` fill columns migration 21 created and older builds
  left empty.

The [scene composition](2026-09-28-activity-scene-composition.md) experiment changed no schema
either:

- Its switch is a new `server_settings` key, `activityVideoExperiment`; a server without the
  row reads it as off. An older build ignores the key.
- A composition run is a row of `activity_runs` with the new kind `composition` and an optional
  `composition` field in its record. An older build lists it as it is stored and names it as a
  specification run, and serves no composition. A composition run still going when an older
  build takes over fails there, since that build looks for a specification to collect.

The [scene video recording](2026-09-28-activity-scene-video.md) changed no schema either:

- A recording run is a row of `activity_runs` with the new kind `video` and an optional `video`
  field in its record. An older build lists it as it is stored and names it as a specification
  run. A recording still going when an older build takes over is marked interrupted there.
- A media asset gained an optional `generatedVideo` field, and its recording lives in the draft
  workspace under `videos/`. An older build refuses to save or re-plan a media plan holding the
  field, since its validator allows no unknown field; unbinding the recording in the newer build
  first, or keeping the newer build, avoids it. Nothing stored is rewritten.
