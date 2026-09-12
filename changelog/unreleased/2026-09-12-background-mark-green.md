# The background-task mark and its count are green again

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-12-background-mark-green.zh.md)

The activity trace that marks a session with background tasks, and the count beside the chat header's stats, went back to the busy emerald — the colour the app uses for live work — after a recent change had muted them along with the scheduled-task mark.

## Details

- `BackgroundTasksMark` (the session row and a tool row's background call) draws in the `busy` ink.
- The chat header's background count uses the same ink, so glyph and number read alike wherever they appear; the tooltip still names the count in words.
- The scheduled-task mark keeps its muted tone.
