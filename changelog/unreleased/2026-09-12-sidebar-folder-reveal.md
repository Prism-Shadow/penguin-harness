# A sidebar folder reveals ten conversations at a time and folds back

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-12-sidebar-folder-reveal.zh.md)

The conversation list's folders — Subagents, Scheduled, Archived — showed every row a fetch
returned and had no way back: expanding Archived with 28 conversations left revealed 13 of them in
one click, and once its share was loaded nothing folded it up again. A folder now follows the same
display rule the active list above it already did: ten rows at a time, "Show N more chats" for the
next ten, and a "Show less" row once the whole share is on screen.

## Details

- Each folder carries its own display cap, stepped a page at a time by its reveal row, and reset —
  like the active list's — on a grouping-mode switch and on a Project change.
- The reveal row reveals rows already in memory first and asks the server for another page only
  when they run short. Under time grouping the folders are one Project-wide set whose fetch fans out
  to every contributing Agent, so a single request can return several pages; the extra rows stay in
  memory under the cap instead of landing on screen at once.
- The row names what it still hides — the rows past the cap plus the folder's unfetched remainder —
  and disappears once nothing is left, with a "Show less" row folding the folder back to its first
  ten. A search still forces every folder open with its matches and offers neither row.
