# Upload media for an activity and bind it from a library

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#30](https://github.com/Prism-Shadow/penguin-harness/pull/30)

Media could only enter an activity two ways: an agent generated it, or an author typed
the path of a file that already existed in the shared WAF checkout. An author can now
upload a file directly and bind a scene asset to it, choosing either the file they just
uploaded or one already uploaded for that activity.

## Where uploads live

An upload is written into the activity's own draft workspace under `PENGUIN_HOME`, at
`media/uploads/<name>-<hash>.<ext>`. The shared WAF checkout stays read-only, as it was.
The stored name carries a hash of the content, so uploading the same file twice lands on
one path and a different file never silently replaces one a scene is bound to.

The format is read from the bytes rather than from the name the browser sent: PNG, JPEG,
GIF and WebP images, WAV, MP3 and Ogg audio, and MP4 and WebM video, up to 32 MiB.
Anything else is refused by format rather than stored and served as something it is not.
An existing file is reused only after its whole digest is compared, so a name can never
stand in for content it does not hold. Listing an activity's media reads directory
metadata only, never the files themselves.

A binding to an upload is checked against what that file actually is, both in the editor
and again when the manifest is saved, so audio cannot be bound to an image asset.

## Endpoints

- `POST /:activityId/media-uploads` stores a file, sent as base64 in a JSON body like the
  existing archive routes, and answers with its stored reference.
- `GET /:activityId/media-uploads` lists what that activity holds.
- `GET /:activityId/media-upload?path=` serves one uploaded file for preview.

## Binding, preview and assembly

The binding editor gained an upload control and a media-library picker with search, a
preview and file details. A bound asset now says whether it is stored with the activity or
read from the checkout. A video or animation bound to an upload plays in place; one bound
to a checkout file still reports that it has no in-app preview, because the server has no
route that would serve it.

Assembly stages uploaded media into the Session workspace beside the generated media, and
resolves `media/uploads/` references there rather than in the checkout, so an assembled
module carries the files an author supplied.

## Compatibility

Nothing already on disk changes. `media/uploads/` is a new prefix; every existing manifest
path keeps resolving from the WAF checkout exactly as before, and no migration runs.
