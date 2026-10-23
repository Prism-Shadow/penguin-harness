# The vision check in model settings sends an image that decodes, and says what it learned

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1265](https://github.com/Prism-Shadow/penguin-harness/pull/1265)
- **Issue:** [#1264](https://github.com/Prism-Shadow/penguin-harness/issues/1264)

[中文版](2026-10-20-vision-probe.zh.md)

The vision check in model settings failed on every endpoint backed by a strict image decoder: the 1×1 probe PNG carried two bytes fewer than its header declared. On the clients that relay the provider's text, the decoder's "unsupported image" was read as the model refusing images, and the switch was turned off on a model that accepts them. The failure toast borrowed the protocol probe's "check the API key and the base URL".

## Details

- **Probe image.** The constant is a 1×1 RGBA PNG whose IDAT inflates to exactly the five bytes its header declares. A test walks the chunks, checks each CRC and inflates the IDAT, so a short image fails in CI rather than at a gateway.
- **Message.** A vision check that learned nothing says so — "Could not tell whether this model accepts images; vision left as it was" — instead of pointing at the key and the URL. The models page in the docs follows.
