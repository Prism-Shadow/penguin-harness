# Pictures into the chat, generated files back out

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#496](https://github.com/Prism-Shadow/penguin-harness/pull/496)

[中文版](2026-08-26-messaging-media.zh.md)

A picture pasted into Feishu or Telegram now reaches the Agent instead of the "text only" notice, and a run's reply is followed into the chat by the files it named. Both directions run over the existing connector seam, so a third channel implements them the same way.

## Inbound images

- An inbound image becomes the same input the web composer submits: the caption (where the channel has one) as user text, then one `image_url` part per image carrying a base64 `data:` URL. A model without vision folds those into scratchpad files exactly as it does for a pasted image.
- Feishu takes the image from the message's `image_key` through `im.v1.messageResource.get`; Telegram takes the largest variant of `message.photo` through `getFile` and the file endpoint, with `message.caption` as the message's text.
- The connector seam carries images as lazily-fetched handles rather than bytes, so a redelivered message is dropped before anything is downloaded, and the size cap rides into the fetch — an oversize transfer is refused at the byte that crosses it instead of being buffered and measured afterwards.
- The ceiling is the server's existing inline-image limit (`INLINE_IMAGE_MAX_BYTES`, 20MB), since these images land in the conversation and the Trace exactly as the composer's do; it also matches Telegram's own 20MB bot download limit.
- An image that is too large and one the channel refuses answer with **different** bilingual notices, and neither starts a Task — a model asked about a picture it never received would answer confidently about nothing. The refusal notice carries the channel's own reason and the failure is recorded as an error: on Feishu the usual cause is the resource-read permission the app was never granted, which is a scope to go and grant rather than anything the code can fix.
- The not-supported notice now names what is supported. Stickers, voice, video and files still get it; inbound files stay out of scope.

## Outbound files

- When a run ends, the files its reply MENTIONED follow the text into the chat: path-like tokens that resolve inside the Workspace and actually exist, wherever in the reply they appear — so what arrives is the output the Agent pointed at rather than everything the run happened to write. Existence is what makes a loose match safe; the Web App's file card reads inline code only, which is too strict for a chat, where a reply naming a file in an ordinary sentence would otherwise deliver nothing.
- Images (`.png/.jpg/.jpeg/.gif/.webp`) are sent as pictures so a chart renders in the chat; everything else is sent as a file. Feishu uploads to `im.v1.image.create` / `im.v1.file.create` and sends the returned key; Telegram posts `sendPhoto` / `sendDocument` as multipart.
- Path resolution, containment and existence come from the same `WorkspaceFilesService` the Files panel reads through — a path that leaves the Workspace, by `..` or through a symlink, is refused there rather than by a second copy of the rules.
- Caps: at most 5 files per run, at most 10MB per image and 30MB per file — the tighter of each channel's own limits (Feishu 10MB image / 30MB file, Telegram 10MB `sendPhoto` / 50MB `sendDocument`). A file a cap drops is named in the chat; a batch cut short says how many were left behind.
- Sends ride the same per-entry chain as the text, so files arrive after the reply that named them and in the order it named them; a failed upload is recorded as an error and does not stop the files behind it.
