# A rejected image no longer ruins the session

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)
- **Issue:** [#944](https://github.com/Prism-Shadow/penguin-harness/issues/944)

[中文版](2026-10-10-rejected-image-recovery.zh.md)

When a vision model's provider refused an image that `read_file` had loaded (from a path or an http(s) URL), for example DeepSeek's `You have uploaded an unsupported image` for a valid 750×8618 PNG screenshot, the request failed as `fatal` and the turn's input, image included, was held over and resent with every later message. Every request after that failed the same way.

- The LLM layer recognises image rejections among provider 4xx errors (unsupported or corrupt images, size limits, models that take no images) and ends the request with `error_code: image_rejected`. OpenAI's `requires N patches after processing, exceeding the limit` wording is among those recognised.
- When the turn's input carries images, the engine replaces them with a note for the model and retries at once. The note gives each image's format, pixel size and byte size, quotes the provider's error, and lists the usual causes, chiefly an image larger than the provider takes, which providers often report as an unsupported format. It then says how to make a copy that passes: cut or downscale the image to at most 2000 px per side with a shell command, then read the copy. That attempt's `request_end` is `retryable` with `retry_in_ms: 0`, and the chat shows it on the retry line. The cleaned input becomes the turn's input, so an interruption or a later message never sends the image again. A rejection with no image left in the input still ends the run, because the bad image is then in the committed history.
- Session resume applies the same replacement to a turn whose `request_end` says `image_rejected`, rebuilding the same note from the recorded `error_message`, so the image does not come back after a restart. The chat still shows the image from the Trace.
- `read_file` identifies an image's format by its bytes alone. A `.png` that is really an SVG, an HTML page or a HEIC file, or a URL that claims `image/png`, is refused with the format it actually is and a request to convert it first. The data URL's MIME type is the sniffed one.
- `read_file`'s line for an image now gives its pixel size (`image/png, 750×8618 px, 960.6 kB`). When the vision model that reads images for a text-only model refuses one, the tool output carries the same causes and advice.
