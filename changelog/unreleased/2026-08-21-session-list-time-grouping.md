# Time grouping for the conversation list, and the Agent in the session details

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#389](https://github.com/Prism-Shadow/penguin-harness/pull/389)

[中文版](2026-08-21-session-list-time-grouping.zh.md)

The chat sidebar's list options gained a third grouping mode next to Workspace and Agent: by time, which cuts the conversations into 近一天 / 近一月 / 更早 (past day / past month / earlier) on each conversation's last activity — the same stamp the rows' compact timestamps and the recency sort already read. Empty buckets are dropped, and the mode persists like the other two. The chat header's details card also gained an Agent row above the Model row.

## Details

- A time bucket spans every Agent and every Workspace, so the Subagents / Scheduled / Archived folders and the list's paging row moved below the buckets as one Project-wide set, with counts and fetch fan-out summed over all Agents. A bucket's own "More" only reveals further loaded rows.
- Group collapse, conversation pins and the manual drag order work in time mode as in the others; the manual order is stored per Project and per grouping mode, so the new mode starts with its own.
- The header's create button follows the grouping mode, and in time mode starts a new conversation.
- The Trace page's tree keeps its Workspace / Agent toggle — its rows are Trace files with no activity timestamp — and reads a stored time preference as Workspace grouping.
- `MoreRow` gained an optional accessible name for rows whose wording is not the shared "More".
