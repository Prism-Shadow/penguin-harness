# Memory changes listed below the file summary

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#375](https://github.com/Prism-Shadow/penguin-harness/pull/375)

[中文版](2026-08-20-memory-change-list.zh.md)

When a Task changed the Agent's Memory, the end-of-Task summary now shows it: a memory-changes card renders directly below the file-summary card, one row per topic file, with the scope (User or Workspace memory) and the change kind (wrote / edited) as icon-and-tooltip markers. The card header links to the Agent's memory tab, the full view of those files; Tasks that touched no memory show no card.

## Details

- Rows come from the structured tool record: successfully completed `write_file` / `edit_file` calls whose path falls under the Session's Memory root (`<agent_state>/memory/`), merged to one row per file — a full write outweighs later in-place edits. Denied or failed calls never appear.
- Each scope's `MEMORY.md` index and the `.workspace` marker are filtered out: the index is rewritten alongside nearly every topic change and would double every row.
- Changes made through an opaque `exec_command` shell (including deletions — no builtin delete tool exists) carry no structured signal and are not listed, matching the file-summary card's existing limitation.
- Root-session Tasks only; a subagent's memory writes belong to that child's own Agent.
