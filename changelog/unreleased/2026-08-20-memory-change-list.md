# Memory changes below the file summary, with diffs in the side panel

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#375](https://github.com/Prism-Shadow/penguin-harness/pull/375)

[中文版](2026-08-20-memory-change-list.zh.md)

When a Task changed the Agent's Memory, the conversation now shows it in two places. A memory-changes card renders directly below the file-summary card at the end of the Task — one row per topic file, with the scope (User or Workspace memory) and the change kind (wrote / edited) as icon-and-tooltip markers. And the chat's side panel became a two-tab panel — Files and Memory, the shared underline tabs — the Memory tab holding two levels: a list of both scopes' topics (the same data the agent-settings memory tab shows, topics changed by this conversation carrying a marker), and one memory's detail — its per-call diffs from this conversation pinned on top, then the content, with a back button to the list. Clicking a card row opens the Memory tab directly on that memory's detail, diff in view; entering through the tab itself always starts at the list. Tasks that touched no memory show no card.

## Details

- Rows come from the structured tool record: successfully completed `write_file` / `edit_file` calls whose path falls under the Session's Memory root (`<agent_state>/memory/`), merged to one row per file — a full write outweighs later in-place edits — and each call keeps its replayable material (the edit's old/new strings, the write's content).
- Diffs replay that material per call, chronologically, without cross-call merging: an edit renders its old/new snippets as removed/added lines; a write renders the written content as added lines — the transcript holds no "before" for a full write, so a repeated write is labeled a rewrite rather than shown as a spliced diff.
- Each scope's `MEMORY.md` index and the `.workspace` marker are filtered out: the index is rewritten alongside nearly every topic change and would double every row.
- Changes made through an opaque `exec_command` shell (including deletions — no builtin delete tool exists) carry no structured signal and are not listed, matching the file-summary card's existing limitation.
- Root-session Tasks only; a subagent's memory writes belong to that child's own Agent.
- A changed file the server listing doesn't carry stays reachable: it is appended to its scope's group and its detail shows the diffs with a note when the content can't load.
- Memory management (add / edit / delete) stays on the agent-settings memory tab; the Memory tab's list header links there. On narrow viewports the panel rides its existing bottom Sheet, tab bar and two-level navigation included; switching conversations resets the tab to Files and the Memory tab to its list.
