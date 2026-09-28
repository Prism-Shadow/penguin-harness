# Deploy an activity to PROD from the Deploy section

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

The Deploy section gained a **PROD** bar under the QA deploy. Once the last QA deploy had
finished and the activity had not changed since, an admin who owned the project pressed
**Deploy to PROD**, typed the product code into the dialog (its confirm button stayed disabled
until the text matched), and Penguin started the same Jenkins activity deploy on the PROD
Jenkins with PROD's tier, environment and framework version, for the activity data QA had,
waited for it, and recorded it as the production deploy. The bar showed the two PROD stages,
why PROD could not start yet, and the last PROD deploy with its framework version and a link to
the Jenkins build. An owner who was not an admin saw that only an admin who owns the project
could deploy to PROD, instead of the button.

## Details

- Two stages followed `await_activity_deploy`: `trigger_production_deploy` noted the newest PROD
  activity deploy and started the activity deploy job with `branch=loom/<pc>-activity-data`,
  `framework_version`, `tier` and `deploy_environment` from the PROD settings,
  `add_activities_to_catalog=false` and `template_names=<pc>`, using the PROD Jenkins address,
  user and token; `await_production_deploy` followed that build every 15 seconds as the QA wait
  did, failing on `build_failed` or `deploy_timed_out` (now naming `target: "prod"`), and
  recorded `prodDeployedAt`, `prodFrameworkVersion`, `productionDeployUrl` and the
  `contentRevision` QA had.
- `POST /api/projects/:projectId/activities/:activityId/deploy` took `stage: "prod"` (or either
  PROD stage) with `confirm`, and an optional `target` that had to match the stage. It answered
  403 `prod_requires_admin` unless the project owner was also a server admin, 400
  `confirmation_mismatch` unless `confirm` was exactly the product code, and
  409 `deploy_blocked` naming the blocker: `previous_stage` until `await_activity_deploy` was
  done, `settings_missing` for an empty PROD setting (`prod.jenkinsUrl`, `prod.username`,
  `prod.token`, `prod.tier`, `prod.environment`, `prod.frameworkVersion`), and `qa_outdated`
  when the QA deploy had finished before the activity data was last published or its deploy
  last started, or the deploying ref's draft revision was no longer the one QA recorded.
- `GET …/deploy` gained `production`: the two PROD stages with their blockers, the blocker for
  Deploy to PROD, and `last`, the newest PROD run that finished a deploy. Starting any QA stage
  set the PROD stages back to pending, as each stage does for the ones after it; the record of
  the last PROD deploy stayed.
- A new kernel service, `ActivityDeployEvents`, told its subscribers once each time a QA or PROD
  deploy finished with success (`projectId`, `activityId`, `runId`, `target`, `revision`,
  `deployedAt`). A subscriber that threw did not affect the deploy or the other subscribers.
- Stored data: see [backward compatibility](2026-09-28-backward-compatibility.md).
