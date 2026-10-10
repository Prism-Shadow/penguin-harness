# A rejected image no longer ruins the session

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[中文版](2026-10-10-rejected-image-recovery.zh.md)

When a vision model's provider refused an image that `read_file` had loaded (from a path or an http(s) URL), for example DeepSeek's `You have uploaded an unsupported image`, the request failed as `fatal` and the turn's input, image included, was held over and resent with every later message. Every request after that failed the same way.

- The LLM layer recognises image rejections among provider 4xx errors (unsupported or corrupt images, size limits, models that take no images) and ends the request with `error_code: image_rejected`.
- When the turn's input carries images, the engine replaces each one with a fixed note telling the model the image was rejected and should be converted to PNG or JPEG. It then retries at once. That attempt's `request_end` is `retryable` with `retry_in_ms: 0`, and the chat shows it on the retry line. The cleaned input becomes the turn's input, so an interruption or a later message never sends the image again. A rejection with no image left in the input still ends the run, because the bad image is then in the committed history.
- Session resume applies the same replacement to a turn whose `request_end` says `image_rejected`, so the image does not come back after a restart. The chat still shows the image from the Trace.
- `read_file` identifies an image's format by its bytes alone. A `.png` that is really an SVG, an HTML page or a HEIC file, or a URL that claims `image/png`, is refused with the format it actually is and a request to convert it first. The data URL's MIME type is the sniffed one.
