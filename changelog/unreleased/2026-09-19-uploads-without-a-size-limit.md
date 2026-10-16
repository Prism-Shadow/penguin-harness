# Uploads have no size limit, and neither API caps its request body

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#805](https://github.com/Prism-Shadow/penguin-harness/pull/805)
- **Breaking:** yes

[中文版](2026-09-19-uploads-without-a-size-limit.zh.md)

The per-file cap, the per-message byte total, the admin fields that set them, the request body cap
derived from them and the fixed refusal on a large inline image are all gone. Every one of those
numbers refused an upload the transport could in fact have carried, and the ceiling was whatever
an operator had typed at some earlier point. What is left is the platform's own ceiling, reported
rather than chosen.

## Details

- **Attachments have no size limit.** A file goes to the Session scratchpad and the model opens it
  by path through its own bounded file tools, so nothing downstream of the upload scales with it.
  `413` `file_too_large` is no longer raised for composer input; the Workspace file endpoints keep
  their own, unrelated.
- **An inline image is compressed, not refused.** The 20MB ceiling is gone, and the browser-side
  compression added alongside it does the work instead.
- **Neither `/api/*` nor `/api/hmr` caps request size.** The body is decoded into one string before
  `JSON.parse` sees it, and V8 caps a string near 512MB, so that is the ceiling whether or not
  anything guards it. `readJson` now separates `ERR_STRING_TOO_LONG` out of the parse error it used
  to collapse into and answers `413` `payload_too_large` naming that ceiling — reported as "must be
  valid JSON" it would have sent someone hunting a syntax error in a body that has none.
- **The per-message file count stays** (20, `413` `too_many_files`). It bounds how many files one
  message can name — that many sequential writes into one directory and that many marker lines on
  one message — which no transport ceiling does.
- **The messaging bridge keeps its own inbound ceilings** (100MB per file, 120MB per message,
  `MESSAGING_INBOUND_FILE_MAX_BYTES` and its budget). They are not the composer's limits under
  another name: they bound a download this server performs because someone posted a file in a chat
  the bot can see, and a fetch with no ceiling has nothing to stop at.

## What this trades away

Stated plainly, since these are the point of the change rather than oversights:

- The server no longer refuses a large inline image from a non-browser client. The Web App
  compresses; an API client posting a 400MB data URL writes 400MB into the Trace and pays that cost
  on every resume.
- An authenticated caller can make the server buffer up to the string ceiling per request, and
  concurrent requests multiply it. The removed `/api/*` cap was what bounded that. Nothing replaces
  it.

## 兼容性

- **API.** `GET /api/me` no longer reports `uploadLimits`; the per-message file count moved to
  `uploadPolicy.attachmentMaxCount`. `PUT /api/admin/settings` no longer takes `attachmentMaxMb` or
  `attachmentTotalMb`, and `400` `invalid_attachment_limit` is gone with them. `413`
  `file_too_large` and `image_too_large` are no longer raised for composer input.
- **On disk.** The `attachment_max_mb` and `attachment_total_mb` rows in `server_settings` are
  simply never read again. There is no migration and no compatibility code: an absent row already
  meant "the default", so a stale one costs nothing and a server that rolls back to an earlier
  build finds its numbers where it left them. Nothing to remove later, and nothing for an operator
  to do.
