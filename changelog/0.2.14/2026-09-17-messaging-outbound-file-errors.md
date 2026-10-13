# Outbound files a channel cannot take are recorded in the Cost Center, not posted into the chat

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#776](https://github.com/Prism-Shadow/penguin-harness/pull/776)

[中文版](2026-09-17-messaging-outbound-file-errors.zh.md)

A reply's file that did not reach a messaging chat — on Feishu, Telegram, QQ or WeChat — no longer
brings a bilingual notice into the chat after the reply, such as the `"xx.md" could not be sent to
the chat` QQ answered with for every file it cannot take. These failures are filed as error records
under the Session's Project instead, one per reply for each cause, and show in the Cost Center's
errors table. The notices for inbound images and files that could not be downloaded, and the
approval reminder, still go to the chat.

## Details

- Four outbound notices were removed: a failed upload, an upload the bot's app lacks a permission
  for, a file over the 10MB-per-picture or 30MB-per-file ceiling, and the files past the 5 that ride
  along with one reply.
- A reply files one record per cause, naming every file it covers, the channel and the reason — one
  line per file when their reasons differ: `messaging_file_send_failed` for refused uploads, in
  separate records for uploads the channel can never carry, a missing permission (the scopes and the
  console link listed once, in place of the channel's reason for each file) and any other refusal;
  the new `messaging_file_too_large` for the files over a ceiling, each with its limit; and the new
  `messaging_files_skipped` for the files past the count. A lone file reads
  `"<file>" was not sent to the <channel> chat: <reason>`. Every message, the skipped files' record
  included, is kept under the recorder's 500-character cap by shortening its file list first, down
  to `…`.
- QQ's refusal of an outbound file no longer names the file, so a reply's refused files share one
  reason line: `QQ cannot receive files: sending a file to QQ requires a publicly reachable URL for
  it, which this server has no way to provide`.
- Kinds: the files over a ceiling, the skipped files and the uploads a channel can never carry (any
  file on QQ) are `expected`; a missing permission on an upload and every other refused upload are
  `unexpected`, since nobody in the chat is handed the fix any more. Records already written keep
  their kind.
- On QQ, a refused file no longer spends a passive-reply slot on a notice.
- The Server API reference states where these cases are recorded, in both languages.
