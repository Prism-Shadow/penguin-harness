# Compare an activity version with the draft, and restore it

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

Each row of the Versions list in the Generation History gained **Compare**, and the project
owner can **Restore** any version other than the one the draft holds. Compare opens a panel below the table with a tab per part that differs from the current draft
(script, specification, media plan, Configuration Data, Assessment Data, implementation
features), each shown as a line diff, and a table of the media files that were added, removed
or changed, with their sizes. Restore, after a confirmation, makes the draft equal that
version and keeps the draft as it was as a version first (an automatic one, unless the draft
already equals the latest version), so a restore can itself be restored away.

## Details

- `GET /api/projects/:projectId/activities/:activityId/versions/:versionId/diff?against=current|<versionId>`
  (any project member) answers `{ files, media }` with only what differs. JSON parts are
  pretty-printed with sorted keys; the current side is worked out from the live draft without
  storing anything. A generated narration or image is matched by the asset it was made for, so
  one generated again under a new run shows as that file `changed`.
- `POST /api/projects/:projectId/activities/:activityId/versions/:versionId/restore`
  (`{ expectedRevision }`, project owner) answers the new draft. Under the activity's lock it
  compares the revision (409 `draft_conflict`), checks every stored file of the version
  (409 `version_incomplete`, naming the first file missing or damaged as `detail.path`, with
  nothing changed) and the version's media plan (422 `media_invalid`), saves an `auto` version
  with reason `before_restore` (even when a file of the draft is missing or changed since it
  was generated, since that is when a restore is most needed), writes the version's media files back
  beside their place and renames them in, writes the implementation-features selection and the
  draft, and records a `restore` version naming its source. Files the draft holds that the
  version lacks are left in place. Restoring the version the draft already holds changes
  nothing.
- A compare with the current draft lists a file the draft binds but the workspace lacks as
  `removed` instead of refusing.
- Each version now keeps the draft's status (migration 22 adds the nullable
  `activity_versions.draft_status`), so a draft whose script was edited after its
  specification comes back from a restore with status `draft`, not `valid`.
- `ActivityAuthoring` gained `replaceDraft`, which writes a whole draft content under the usual
  compare-and-set and works out its status as saving a specification does, unless told the
  specification is stale; a stored specification that no longer validates is kept with status
  `invalid`. `exclusive` lets a
  nested `exclusive` and the revision-checked draft changes join the run it already holds.
- An error body may now carry `detail`, an object of strings naming what a refusal is about;
  the App's `ApiError` exposes it. The App's new types are `VersionDiff`, `VersionFileDiff`,
  `VersionFileName` and `VersionMediaDiff`. A refused restore names the missing file in the
  confirmation; unsaved
  edits in the editor are called out there before they are replaced.
- The version name's hint no longer calls the field optional.
