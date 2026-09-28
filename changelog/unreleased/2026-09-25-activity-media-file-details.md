# File details for bound audio and video

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

The asset editor showed a bound audio or video file's details under its player: format, file
size, length and bitrate, and for video its width and height, so an author could spot a clip
that was too long, too large or in the wrong format before assembling.

## Details

- `GET /api/projects/:projectId/activities/:activityId/media-stats` gave each asset a
  `mimeType`, named from the bound file's extension (`audio/wav`, `audio/mpeg`, `audio/ogg`,
  `video/mp4`, `video/webm`, and the image types), or `null` for an unbound asset or an
  extension that is not a media type.
- The size and format came from the upload listing for an uploaded file, otherwise from the
  media stats of the saved draft, read once per draft revision while **Scenes and media** was
  open. A binding changed but not yet saved showed no size, rather than the old file's.
- The length (and a video's dimensions) came from the browser reading only the file's
  metadata; a narration whose waveform had been decoded used that length. Bitrate was the
  average, file size over length, in kbps.
- Each value read **Measuring…** until it was known and a dash when it could not be, such as
  for a missing file. An unbound asset showed no details.

## Compatibility

`mimeType` was additive. An App reading an older server's stats, which lack it, showed the
format as unknown.
