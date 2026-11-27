# Messaging channels accept mixed messages

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `messaging`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[中文版](2026-11-27-messaging-mixed-content.zh.md)

A picture with words, a file with a note, or several attachments sent together reached the bound Session as one user input, the way the Web App's composer sends text with attachments. Feishu rich-text messages, which had been answered with the not-supported notice, were read.

## Details

- Feishu: a `post` message became its words (title first, links as Markdown, mentions resolved as in a `text` message, code blocks fenced), followed by its pictures in order; files attached to a post arrived as files. A video in a post and an attached folder were named as left out.
- Telegram: the items of an album, which share a `media_group_id`, were composed into one input once the chat had been quiet for a moment. The caption counted as the album's text whichever item carried it, a video item included.
- On every channel, an image or file sent on its own and followed at once by text from the same person became one input. A text was never held back, so text sent before its attachment still arrived as a separate input. In a group, only the sender's own text joined.
- A part that could not be delivered no longer stopped the whole message: the rest reached the Agent, and the chat got one bilingual line naming each part left out and why. A message none of whose attachments arrived was still stopped whole, with the notice for its cause. The composer's per-message file count applied to inbound files too.
- The not-supported notice read "Only text, images and files are supported for now. 目前仅支持文本、图片和文件。" instead of naming message kinds.
- The connector seam's inbound message gained `omitted`, `groupId` and `senderId`.
- The remote-control docs described mixed messages, and their QQ section stopped saying that QQ carries text only.
