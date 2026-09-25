# Saved versions of an activity

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

The Generation History gained a **Versions** list and a **Save version** button. An author
saves the activity as it is, optionally under a name of up to 80 characters, and sees every
version with its number, name, kind, time, author, media size, and which one the draft holds
now.

## Details

- A version holds the draft's script, specification, media plan and edited module documents,
  the implementation-features selection, and the bytes of every generated narration and image
  and every upload the media plan binds. Media bound from the WAF checkout is recorded by its
  path only and never copied.
- Files are stored once per activity as content-addressed blobs under
  `<collection>/activities/<activityId>/versions/blobs/<sha256>`, next to the version manifest
  in canonical JSON. Every read checks the digest; a blob name that is not a digest is refused.
- Saving with nothing changed since the latest version makes no new version and returns that
  one; the App says no new version was saved. An empty implementation-features selection counts
  the same as none. A generated file that no longer matches its recorded
  digest, or a bound file that is missing, refuses the save (`version_media_changed`,
  `version_media_missing`).
- Routes: `GET /api/projects/:projectId/activities/:activityId/versions` for any project member,
  and `POST` of the same path (`{ label?: string | null }`) for the project owner. It answers
  `{ version, created }`: 201 when the save made a version, 200 when nothing changed.
- A new kernel service, `ActivityVersions` (`ActivityVersionService`), saves versions under the
  activity's lock, reached through the new `ActivityAuthoring.exclusive`. The App's
  types are `VersionSummary`, `VersionKind` and `VersionReason`.
- The specification diff's explanation no longer says a draft has no version history.
