# Outbound files a channel cannot take are recorded in the Cost Center, not posted into the chat

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `docs`
- **PR:** [#776](https://github.com/Prism-Shadow/penguin-harness/pull/776)

[中文版](2026-09-17-messaging-outbound-file-errors.zh.md)

A reply's file that did not reach a messaging chat — on Feishu, Telegram, QQ or WeChat — no longer
brings a bilingual notice into the chat after the reply, such as the `"xx.md" could not be sent to
the chat` QQ answered with for every file it cannot take. Each case is filed as an error record
under the Session's Project instead, and shows in the Cost Center's errors table. The notices for
inbound images and files that could not be downloaded, and the approval reminder, still go to the
chat.

## Details

- Four outbound notices were removed: a failed upload, an upload the bot's app lacks a permission
  for, a file over the 10MB-per-picture or 30MB-per-file ceiling, and the files past the 5 that ride
  along with one reply.
- Each case files one record whose message names the file (or how many files), the channel and the
  reason: `messaging_file_send_failed` for a failed upload, carrying the missing scopes and the
  console link when a permission is missing; the new `messaging_file_too_large` for a file over a
  ceiling; and the new `messaging_files_skipped`, once per reply, for the files past the count.
- Kinds: a file over a ceiling, the skipped files and an upload the channel can never carry (any
  file on QQ) are `expected`; a missing permission on an upload and every other failed upload are
  `unexpected`, since nobody in the chat is handed the fix any more. Records already written keep
  their kind.
- On QQ, a refused file no longer spends a passive-reply slot on a notice.
- The Server API reference states where these cases are recorded, in both languages.
