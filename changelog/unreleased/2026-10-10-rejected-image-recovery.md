# A rejected image no longer ruins the session

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)
- **Issue:** [#944](https://github.com/Prism-Shadow/penguin-harness/issues/944)

[中文版](2026-10-10-rejected-image-recovery.zh.md)

When a vision model's provider refused an image that `read_file` had loaded (from a path or an http(s) URL), for example DeepSeek's `You have uploaded an unsupported image` for a valid 750×8618 PNG screenshot, the request failed as `fatal` and the turn's input, image included, was held over and resent with every later message. Every request after that failed the same way.

- A provider 4xx on a request whose input carries images is treated as a rejection of the images, whatever the message says: providers word these refusals too many ways for text matching to be reliable. The engine records that attempt's `request_end` as `retryable` with `error_code: image_rejected` and `retry_in_ms: 0`, replaces every image in the turn's input with a fixed note (`[image not sent: the current model rejected the request while it carried this image, so the request was sent again without the image.]`) and retries at once; the provider's error reaches the model through the retry's `[request_error]` line (see [Retries tell the model what failed](2026-10-11-retry-carries-error.md)); the chat shows it on the retry line. The cleaned input becomes the turn's input, so an interruption or a later message never sends the image again. A 4xx on an input with no image still ends the run.
- Session resume applies the same replacement to a turn whose `request_end` says `image_rejected`, so the image does not come back after a restart. The chat still shows the image from the Trace.
- `read_file` identifies an image's format by its bytes alone. A `.png` that is really an SVG, an HTML page or a HEIC file, or a URL that claims `image/png`, is refused with the format it actually is and a request to convert it first. The data URL's MIME type is the sniffed one.
