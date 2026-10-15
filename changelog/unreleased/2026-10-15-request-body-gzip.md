# Gzip'd request bodies for task and steer posts

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `server`, `web`
- **Issue:** [#521](https://github.com/Prism-Shadow/penguin-harness/issues/521)

[中文版](2026-10-15-request-body-gzip.zh.md)

A draft chat has no Session, so file attachments ride the task request itself as base64 `data:` URLs — a third larger again, and nothing compressed them, so a 100MB log cost ~134MB of wire. The Web App's task and steer senders now offer the whole serialized request body gzipped, and the server inflates it, bounded, before any route reads the JSON. A request that arrives without the coding takes exactly the path it took before, so non-browser API callers are unaffected.

## Details

- The sender gzips only when gzip actually makes the body smaller: small bodies travel untouched, and an attachment of already-compressed bytes (`.zip`, `.jpg`, `.mp4`) is sent plain rather than paying a pass to add bytes. The coding is lossless end to end — a file attachment cannot lose a byte, so this is transport coding, unlike the image intake's re-encode.
- The inflate is bounded: `gunzipSync` runs with `maxOutputLength` derived from the existing request body cap, so a gzip bomb answers `413` `payload_too_large` instead of allocating, and a body that does not decompress is a `400` `bad_request`. The wire cap still counts compressed bytes; the inflate bound is what limits memory.
- The steer route's `files` field takes the same `{fileName, dataUrl}` parts as a task, so a gzipped steer body carries attachments the same way.
