# Large images are compressed in the browser before they are uploaded

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#802](https://github.com/Prism-Shadow/penguin-harness/pull/802)

[中文版](2026-09-19-image-compression.zh.md)

An image placed inline in a conversation is written into the Trace and read back whole on every
history page and every Session resume, so its size is paid again and again. The composer now
resizes and re-encodes a large one before it is read into a `data:` URL, so the upload shrinks
with the picture instead of the picture being turned away at 20MB.

## Details

- **System settings → Uploads** (admin, server-global) carries the switch and the threshold
  beside the existing attachment limits: on by default, above 4MB, settable 1–64MB.
- The re-encode fits the image inside a 2048px box and keeps its own format, so alpha survives
  and nothing downstream meets a format it did not already accept. Animated and vector images
  (GIF, SVG) are never touched — a canvas round trip returns a first frame or a rasterization,
  which is a different picture rather than a smaller one.
- Every failure path sends the original: no `createImageBitmap`, a decoder that refuses, a canvas
  that will not read back, or a re-encode that comes out no smaller.
- The inline-image cap still applies, to the picture as it will be uploaded — compression is
  measured before the check, so a photo that used to be refused whole now often goes through.
- `GET /api/me` reports the policy under `uploadPolicy`; `PUT /api/admin/settings` takes
  `imageCompression` and `imageCompressionOverMb`, with an out-of-range threshold refused as
  `400` `invalid_image_compression`. The policy shapes what a client uploads and gates nothing.
- The settings page is now called **Uploads** rather than **Upload limits**: it no longer holds
  only limits.
