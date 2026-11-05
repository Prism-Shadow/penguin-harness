# Clicking a cited file opens a preview beside the channel or the conversation

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `web`
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[中文版](2026-11-05-cited-file-preview.zh.md)

In a channel, clicking a file a message cites opens it in a panel to the right of the messages. On a phone the panel covers them. In an organization's conversation (a desk or a ticket session), the file opens in the dock's "File preview" tab. Markdown reads in the reader, text as highlighted source, and images and PDFs as themselves. The title row copies the full path, downloads the file, and holds the reader's outline and find.

## Details

- Only a file capsule opens a preview. A folder capsule still copies its path, and so does every capsule in a ticket, where the preview would have to stack a second layer over the ticket dialog.
- The preview reads the file through the organization's cited-file route. A file outside the organization's handbook and workspaces, and a missing file, each read as a sentence in the panel.
- The dock tab shows the file only while the conversation on screen belongs to the organization it was opened from.
