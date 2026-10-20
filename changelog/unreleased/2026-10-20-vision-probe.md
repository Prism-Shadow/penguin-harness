# The vision check in model settings works, and repeats what the provider said

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-10-20-vision-probe.zh.md)

The vision check failed on every endpoint backed by a strict image decoder, and reported "cannot detect the API protocol; check the API key and base URL". Two causes: the 1×1 probe PNG carried two bytes fewer than its header declared, and a gateway's own error text never reached the caller.

## Details

- **Probe image.** The constant is now a 1×1 RGBA PNG whose IDAT inflates to exactly five bytes — one filter byte plus four channels — so strict decoders accept it. A regression test walks every chunk, checks its CRC, inflates the IDAT and compares the length the colour type requires.
- **Message.** A failed vision check has its own copy; it no longer borrows the protocol probe's "check the API key and base URL".
- **Provider text.** Startup wraps the global fetch: for an error response that is JSON, a plain object and carries no top-level `error`, it adds the `error` the OpenAI SDK reads, keeping the provider's own fields beside it. A non-OpenAI error body therefore reaches the classifier, so "this model refuses images" turns the switch off instead of being recorded as merely failed.
- **Verified.** Against the real gateway the broken image moves from `failed` to `unsupported`, the fixed image classifies as `supported`, and both OpenAI-compatible clients agree.
