# The small-window notice no longer crushes the conversation on a phone

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `web`
- **PR:** PR_URL

[中文版](2026-09-28-small-window-notice-on-phones.zh.md)

When the model's context window is smaller than the agent's compaction threshold, the composer shows
a notice with Dismiss and Open agent settings buttons. On a phone the buttons stayed beside the text
and squeezed it into a narrow column. At 390 px wide the notice grew to about 490 px and left the
conversation a 48 px strip, where the stuck work-group header covered a pending approval's Allow
and Deny buttons. When the text and the buttons don't fit side by side, the buttons now wrap onto
their own line below the full-width text.
