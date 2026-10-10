# A tool-result image over the model's pixel cap is refused at the tool instead of 400-ing the Session forever

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`
- **Issue:** [#944](https://github.com/Prism-Shadow/penguin-harness/issues/944)

[中文版](2026-10-10-tool-image-dimension-cap.zh.md)

A `read_file` on a very tall or very wide image — a full-page screenshot, a long chart — could hand the model an image the endpoint refuses outright. Providers cap an image's longest side (DeepSeek draws the line at 8192 px and answers one over it with a blanket 400 that reports an unsupported *format*), the image itself is a perfectly valid file, and because the fatal tool result is replayed with every later request, the Session then failed the same way at the same input index on every turn — nothing in a Session can drop the attachment, and compaction cannot run either. `read_file` now reads the image header and refuses to attach an image past the cap, saying so in its own output.

## Details

- `read_file`'s image branch parses pixel dimensions from the header alone (PNG IHDR, JPEG SOF frame header, GIF logical screen descriptor, WebP VP8/VP8L/VP8X — the first bytes of the file, no new dependency, no pixel decode) and, when the longer side exceeds the model's cap, fails with the dimensions and the real reason: `Image too large for this model: 750×8618 px exceeds the 8192 px longest-side limit, so it is not attached. […] Downscale the image first (e.g. with a shell command) and read the smaller copy.` The guard covers the local and URL branches alike and fires before a text-only session's vision model is called. Bytes whose header parses to nothing (the extension fallback can let headerless content through as an image) are not refused — there is no basis to.
- The cap follows the model: a Project's model entry can pin its own with `max_image_side` (px, longest side), a builtin catalog row can carry one (`maxImageSide`, which seeds the Project entry on "Restore defaults"), and with neither the conservative default is 8192 px (`MAX_IMAGE_SIDE`). The value travels to the tool as a per-context service (`EnvironmentServices.maxImageSide`), re-resolved on a model switch the same way the vision-describer answer is.
- The byte cap (5 MB) and every other validation are untouched; an image within both bounds attaches exactly as before. A Transcript already carrying an over-limit attachment still needs a recovery path (dropping or downscaling that one attachment) — that is a separate change.
