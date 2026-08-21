# Memory changes below the file summary, with diffs in the side panel

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#375](https://github.com/Prism-Shadow/penguin-harness/pull/375)

[中文版](2026-08-20-memory-change-list.zh.md)

When a Task changed the Agent's Memory, the conversation now shows it in two places. A memory-changes card renders directly below the file-summary card at the end of the Task — one row per topic file, with the scope (User or Workspace memory) and the change kind (wrote / edited) as icon-and-tooltip markers. And the side panel gained a Memory view, a sibling of the Workspace file tree behind a flat two-glyph toggle in the panel's title row: this conversation's changes with a per-call diff for each file, followed by the Agent's memory itself — both scopes' topic lists and read-only content, the same data the agent-settings memory tab shows. Clicking a card row opens that view located at the row: expanded on its diffs, scrolled to and briefly highlighted. Tasks that touched no memory show no card.

## Details

- Rows come from the structured tool record: successfully completed `write_file` / `edit_file` calls whose path falls under the Session's Memory root (`<agent_state>/memory/`), merged to one row per file — a full write outweighs later in-place edits — and each call keeps its replayable material (the edit's old/new strings, the write's content).
- Diffs replay that material per call, chronologically, without cross-call merging: an edit renders its old/new snippets as removed/added lines; a write renders the written content as added lines — the transcript holds no "before" for a full write, so a repeated write is labeled a rewrite rather than shown as a spliced diff.
- Each scope's `MEMORY.md` index and the `.workspace` marker are filtered out: the index is rewritten alongside nearly every topic change and would double every row.
- Changes made through an opaque `exec_command` shell (including deletions — no builtin delete tool exists) carry no structured signal and are not listed, matching the file-summary card's existing limitation.
- Root-session Tasks only; a subagent's memory writes belong to that child's own Agent.
- Memory management (add / edit / delete) stays on the agent-settings memory tab; the view's header links there. On narrow viewports the view rides the panel's existing bottom Sheet.
