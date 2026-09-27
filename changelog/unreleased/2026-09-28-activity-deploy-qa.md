# Deploy an activity to QA from the Deploy section

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

The Deploy section gained **Deploy to QA**. The project owner pressed it on the canonical ref,
confirmed what it pushes and starts, and Penguin ran up to ten stages: the module release
(skipped when it was already done for the module as now assembled), then it wrote the
activity's data into the activity-data clone, checked it, put the media files only the draft
held into the media repository, pushed the activity data, started the Jenkins activity deploy
to QA, and waited for it. Once QA had the activity, the section linked to it with **Open on QA**
and named the module version it went with. Each of the six new stages could also be run on its
own under **Run one stage**; the ones that push or start a Jenkins job asked first.

## Details

- `export_activity_data` put the activity-data clone on `loom/<pc>-activity-data` as origin had
  it (from `origin/main` when origin had no such branch), then wrote, for every ref of the
  product that was not archived, `data/configurations/loom/<pc>-<ref>.json` and, for a ref whose
  specification used the assessment, `data/assessments/loom/<pc>-<ref>.json`; then
  `data/templates/loom/<pc>.json` and `deployLists/loom-<pc>.txt`. The configuration was the
  author's edit when there was one, else the newest assembled module's, else the checkout
  module's; the assessment was the one in effect for the ref. Each media file a ref's media
  plan bound was written into its language group under the asset's key (and the module's key
  for a renamed asset), and every media address pointed at the new **Media address** deploy
  setting (`repos.mediaPublicBase`). Its default, `{{MEDIA}}/`, kept the framework's token,
  which is what the activity-data deploy recognises, publishes and points at its media host; a
  path such as `/media/` or an `https://` address replaced the token.
- The template named each ref as a source (`description` its display name or `Ref <n>`), and
  its layout `mainOnly` with the main compartment `<published name>@^<released version>` in
  the specification's theme (`park` when none) and the navigation bar `navbar@^3.0.0` themed
  blue for `r…` products, green for `m…` products and park otherwise.
- `verify_activity_data` checked that the deploy list named exactly the template, that the
  template named the released module and files that were there, that each configuration and
  assessment was a JSON object, that an assessment a ref used had items (as many as its
  `maxItems` said), and that every media reference was a relative path under the media folder,
  not a preview address or a leftover token. Errors failed the stage (`preflight_failed`);
  warnings were only reported. The findings were stored as codes the page worded.
- `verify_media_assets` put the media clone back to `main` as origin had it, copied each media
  file the data named that the draft held and the clone lacked or held differently (adding its
  folder to the clone's sparse set first), and failed with `media_missing`, naming the files,
  when one was neither in the draft nor in the repository's tree. It committed and pushed
  `main` only when it had copied something. Files were copied as they were.
- `publish_activity_data` committed the exported files as the configured git identity and ran
  `git push -u origin loom/<pc>-activity-data`, without force.
- `trigger_activity_deploy` started the activity deploy job with `branch`, `framework_version`,
  `tier`, `deploy_environment`, `add_activities_to_catalog=false` and `template_names=<pc>`, and
  recorded the QA address `<activity address>?productCode=<pc>&refNum=<ref>&frameworkVersion=<v>`.
  `await_activity_deploy` looked every 15 seconds for the build with those parameters that was
  newer than the one noted before the trigger, until it succeeded, failed (`build_failed`) or
  the configured deploy minutes passed (`deploy_timed_out`); it recorded `qaDeployedAt` and the
  exported draft revision as `contentRevision`.
- `POST /api/projects/:projectId/activities/:activityId/deploy` took `stage: "qa"` and each new
  stage name. A QA deploy left the four release stages out, and recorded them in the run's
  `skipped`, when all four were done since the last verify and that verify had checked an
  assembled module with the same content hash (`moduleContentHash`); without an assembled
  module the release always ran. The stage list, blockers and run records covered all ten
  stages.
- Every stage now started past uncommitted changes and unpushed commits in the activity-data and
  media clones, as it already did in the module clone: the stages that work in those clones put
  them back as origin had them first.
- Stored data: see [backward compatibility](2026-09-28-backward-compatibility.md).
