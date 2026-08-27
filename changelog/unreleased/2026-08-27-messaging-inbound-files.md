# Files into the chat, as composer attachments

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#513](https://github.com/Prism-Shadow/penguin-harness/pull/513)

[中文版](2026-08-27-messaging-inbound-files.zh.md)

A document sent to the bot on Feishu or Telegram now reaches the Agent instead of the "not supported" notice. It arrives as the web composer's own file attachment — written into the Session scratchpad and handed to the model as an `[attached file: <path>]` line — over the same connector seam the inbound images landed on, so a third channel implements it the same way.

## Inbound files

- The connector seam gained `MessagingInboundMessage.files`: lazily-fetched handles carrying the sender's file name, alongside the image handles and for the same two reasons — a redelivered message is dropped before anything is downloaded, and the cap rides into the fetch, so an oversized attachment is refused at the byte that crosses it instead of being buffered and measured afterwards. It is optional, so a channel that delivers no files never populates it.
- A file goes down the composer's attachment path, not the conversation: `attachFilesToInput` writes it into `<agent>/scratchpad/<sessionId>/` under a name sanitized for the filesystem, and the message text gains one `[attached file: <absolute path>]` line per file, which the model opens with its ordinary file tools. Nothing scales with the file's size downstream, which is what makes the far larger ceiling reasonable.
- The caps are the server's own attachment limits — the admin-settable per-file cap (100MB by default) and the per-message total (120MB) an authenticated composer upload answers to — read fresh per message rather than snapshotted, and narrowed further by any tighter ceiling the channel itself has. Each later file of one message is capped at what is left of the message's total, so a batch cannot add up past it.
- There is no rolling per-binding budget like the image one: the cost that budget exists to prevent is not paid here. An inline image is written into the Trace and re-read whole on every history page and every resume; a file is bytes on disk that nothing re-reads and that are deleted with the Session.
- A file over a cap, a batch over the per-message total, a permission the bot lacks and a transfer that failed answer with **four different** bilingual notices, each naming the file. None of them starts a Task — a model asked about a document it never received answers confidently about nothing — and none of them leaves a half-written batch behind in the scratchpad. A refusal for size is nobody's fault and stays out of the error log; a failure is recorded under `messaging_file_fetch_failed` with the channel's own reason, classified the way the inbound image download already is — a scope the app was never granted is `expected`, because the chat has already been handed the fix, and only what nobody was told about counts as a defect.
- A size refusal names the ceiling that actually bit, which is not always the one the server asked for: `MessagingMediaTooLargeError` now carries its `maxBytes`, so a channel that narrows the transfer reports its own number rather than sending the sender to shrink a file against a limit that was never in the way.
- A caption is the message's text, exactly as a photo's already was, so text, images and files compose one input. The caption of a message whose attachment is NOT delivered still normalizes to null.
- A message that arrives while the Session is busy is queued as a follow-up, and withdrawing that follow-up in the Web App now hands its files back as attachment chips and deletes the scratchpad copies. The queued line counts them too. Only the writer knows where the bytes landed, so the inbound path supplies its own recall store rather than leaving one to be derived from the input — derived, the recalled text came back carrying a raw `[attached file: <path>]` line and the file stayed on disk.

## Feishu

- The `file` message type, downloaded through `im.v1.messageResource.get` with `type: "file"` — the same resource endpoint the images use, differing only in that query parameter, and permissioned by the same scope, so an app refused an image is refused a file by the same `99991672` denial and gets the same notice naming the scopes and the console link to grant them.
- The event names the file, so the sender's own name reaches the model. An event carrying none gets the placeholder `file` rather than an invented extension.
- `audio` (a voice recording) and `media` (a video) carry a `file_key` too and are deliberately left out: they are re-encoded for playback and named by nothing the sender chose, and nothing downstream decodes or transcribes them. Both keep the not-supported notice.

## Telegram

- The `document` field — a file the sender chose to send AS a file, and the only one of the Bot API's media fields that carries the sender's own name. A picture dragged in uncompressed is a `document` too and now arrives as an attachment, which is what the sender asked for by sending the original bytes.
- `audio`, `video`, `voice` and `video_note` are out of scope for the same reason Feishu's are, and say so rather than faking it. A `voice` is a nameless opus blob; handing one over as an `[attached file: …]` path would offer a capability that is not there.
- Transfers are capped at Telegram's own 20MB bot download ceiling (`TELEGRAM_MAX_DOWNLOAD_BYTES`) rather than left to the Bot API to refuse. Past it `getFile` answers a 400 whose only signal is prose Telegram is free to reword, so a size the sender can act on would have reached them as an unexplained download failure.

## Notices

- The not-supported notice names what is supported, so it now reads "Only text, image and file messages are supported for now." Its constant is `MESSAGING_UNSUPPORTED_NOTICE`.
