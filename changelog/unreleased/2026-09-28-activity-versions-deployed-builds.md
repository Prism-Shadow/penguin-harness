# Automatic versions, deployed markers and module builds

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

Applying an agent's whole proposal started keeping the draft as it was as an automatic version
first. A finished QA or PROD deploy marked the version that went there, and the Versions
heading in the Generation History gained a line for QA and for PROD saying whether the activity
was in sync, had changed since that deploy, or was never deployed; rows that went there got a
**QA** or **PROD** badge. Automatic versions beyond the newest 20 were removed from then on,
with the stored files only they held. A new **Module builds** list was added to the Generation
History: it showed every succeeded assembly with its file count, compared two builds file by
file, and **Play this build** kept the preview on an older build, under a notice, until it was
unpinned.

## Details

- `POST …/runs/:runId/proposal/apply` was changed to keep an `auto` version with reason
  `before_proposal` under the activity's lock before it applied the proposal. A stale
  `expectedRevision` was refused before anything was kept; a draft that equalled the latest
  version kept nothing new; when the proposal was refused, the kept version stayed and a second
  try kept nothing new. `ActivityVersions.keepBefore` was added for this, so `ActivityService`
  never used the version service.
- The version service was subscribed to the deploy events hook. A QA or PROD deploy of the
  draft as it was kept a `deploy` version (or the latest version, when it held the same content)
  and set its `deployed_qa_at` or `deployed_prod_at`. When the draft changed after the deploy
  took it, the newest version whose content had the deployed revision was marked instead; with
  none, nothing was marked. `ActivityVersions.markDeployed` was added for this and was callable
  on its own.
- `GET …/activities/:activityId/versions/status` (any project member) was added. It answered
  `{ qa, prod, qaVersion, prodVersion }`, where each target was `never`, `in_sync` or `changed`,
  comparing the last version deployed there with the draft's content, media and implementation
  features.
- After each new version, `auto` versions beyond the newest 20 that did not go to QA or PROD
  and that no version was restored from were deleted, then every blob in the activity's blob
  folder that no remaining version referenced. A version being restored was never deleted by
  the save made just before it. A version whose stored record could not be read stopped the
  blob sweep.
- Each new version recorded a module build as `module_run_id`: a `deploy` version the newest
  build, which was what a release shipped, and any other version the build the preview played.
- `GET …/activities/:activityId/module-builds` (any project member) was added. It listed the
  succeeded module runs, newest first and however many runs of other kinds came after them,
  with how many source files each held (`node_modules`, `.git`, `dist`, `build` and
  `.typescript-build` left out), the pinned build and the build the preview played.
  `GET …/module-builds/diff?from=&to=` answered the files added, removed or changed by SHA-256
  between two of them, with the text of `.js`, `.ts`, `.json`, `.css`, `.scss` and `.html`
  files up to 200 KB each. `ActivityGeneration` gained `moduleBuilds`.
- `POST …/module-builds/:runId/pin` and `POST …/module-builds/unpin` (`{ expectedRevision }`,
  project owner) were added. They set or removed the draft's optional `pinnedModuleRunId` and
  answered the draft. Only a succeeded module run of the activity could be pinned (404
  `module_build_not_found`). The sandbox played the pinned build while it was still a succeeded
  module run, else the newest. `ActivityAuthoring` gained `pinModuleRun`.
- The pin was left out of the draft's revision, since it only chose what the preview played.
  Pinning or unpinning a build therefore never made a candidate waiting to be accepted, a stage,
  a module build or a QA deploy out of date, and it worked while a run was in progress;
  `expectedRevision` only checked that the author had seen the current draft. The Deploy
  section gained a notice while a build was pinned, since a release shipped the newest build.
- The App's new types were `VersionStatus`, `DeployDrift`, `DeployedVersion`, `ModuleBuild`,
  `ModuleBuildList`, `ModuleBuildDiff`, `ModuleBuildFileDiff`, `ModuleBuildChange` and
  `ModuleBuildText`.
- The draft gained an optional field; see [backward compatibility](2026-09-28-backward-compatibility.md).
