# Uploads have no size limit; large images are compressed instead

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#426](https://github.com/Prism-Shadow/penguin-harness/pull/426)
- **Breaking:** yes — the admin-settable attachment limits are gone: `attachmentMaxMb` and `attachmentTotalMb` no longer exist on `/api/admin/settings`, and `GET /api/me` reports `uploadPolicy` in place of `uploadLimits`.

[中文版](2026-08-27-uploads-without-a-size-limit.zh.md)

A file attachment had a per-file cap, a per-message byte total, an admin form to set both, and a
request body cap derived from them; an inline image had a fixed 20MB refusal. All of it is gone.
An attachment may now be any size, and an image over a configurable threshold is resized and
re-encoded in the browser before it is uploaded rather than being turned away.

## Details

- **File attachments have no size limit at all.** The bytes go to the Session scratchpad and the
  model opens them by path, so nothing downstream scales with them. What remains is the per-message
  file count (20, `413` `too_many_files`) and the request body cap.
- **The request body cap is a fixed 384MB**, no longer derived from a setting. It marks where the
  transport stops working — the body is buffered and JSON-parsed as one string, and V8 caps a
  string near 512MB — rather than a policy about what may be sent, and it is above every body the
  derived cap could previously reach.
- **Automatic image compression** (**System settings → Uploads**, admin, server-global): a switch,
  on by default, and a threshold in whole MB, 4 by default and settable between 1 and 64. An image
  over the threshold is fitted inside a 2048px box and re-encoded in its own format before it is
  read into a data URL, so the upload shrinks with the picture. An image under it, and any
  animated or vector image (GIF, SVG), is sent byte-for-byte; a re-encode that comes out no
  smaller than the source is discarded.
- **`GET /api/me` reports `uploadPolicy`**: the two settings, the range the threshold accepts, and
  the per-message file count. It shapes what a client uploads and gates nothing — an API client
  that ignores it is not refused.
- The `413` codes `file_too_large` (for a composer attachment) and `image_too_large` are no longer
  raised; `PUT /api/admin/settings` answers `400` `invalid_image_compression` for a threshold
  outside the range, in place of `invalid_attachment_limit`.

## Compatibility

- A client reading `uploadLimits` from `GET /api/me`, or writing `attachmentMaxMb` /
  `attachmentTotalMb` to `PUT /api/admin/settings`, has to be updated: the fields are gone, and an
  unknown field in a PUT is ignored rather than refused.
- Stored `attachment_max_mb` and `attachment_total_mb` rows in `server_settings` are left in place
  and never read again. Nothing has to be migrated or deleted; a server that had its limits
  lowered simply stops applying them.
