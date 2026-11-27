# QQ bot carries images, files and voice transcripts in both directions

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `messaging`
- **PR:** [#1908](https://github.com/Prism-Shadow/penguin-harness/pull/1908)

[中文版](2026-11-26-qq-rich-media.zh.md)

The QQ channel no longer refuses files. Replies can now send the images and files an Agent wrote, and
the images, files and voice messages a user sends reach the Agent.

## Details

- Outbound files are registered through the rich-media upload API (`file_data` for small files; `upload_prepare`, part PUT, `upload_part_finish` and merge for larger ones) and sent as a `msg_type: 7` passive reply. No public URL is needed.
- A file takes one passive-reply slot, only while no text is withheld for the final slot. A file that has no slot, or that QQ refuses, leaves a one-line note in the chat and still files an error record. A picture format QQ refuses is re-sent as a file.
- Inbound `attachments` become images and files for the Agent; a voice message arrives as QQ's own transcript; a quoted message's text rides above the reply as a blockquote.
