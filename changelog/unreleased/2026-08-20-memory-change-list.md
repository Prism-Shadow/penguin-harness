# Memory changes below the file summary, with a peer Memory side panel

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#375](https://github.com/Prism-Shadow/penguin-harness/pull/375)

[中文版](2026-08-20-memory-change-list.zh.md)

When a Task changed the Agent's Memory, the conversation now shows it in two places. A memory-changes card renders directly below the file-summary card at the end of the Task — one row per topic file, with the scope (User or Workspace memory) and the change kind (wrote / edited) as icon-and-tooltip markers. And the chat gained a Memory panel — a peer of the subagents, terminal and Workspace panels, with its own entry in the panel switcher and the same docked/Sheet shell and exclusivity — holding two levels: a list of both scopes' topics (the same data the agent-settings memory tab shows, topics changed by this conversation carrying a marker), and one memory's detail, its content rendered like the file viewer. Clicking a card row opens the panel directly on that memory's content; entering through the panel switcher always starts at the list. Tasks that touched no memory show no card.

## Details

- Rows come from the structured tool record: successfully completed `write_file` / `edit_file` calls whose path falls under the Session's Memory root (`<agent_state>/memory/`), merged to one row per file — a full write outweighs in-place edits. Denied or failed calls never appear.
- A changed file the loaded listing no longer carries was deleted afterwards: it leaves the card and the panel list. While the listing hasn't loaded, nothing is treated as deleted.
- Each scope's `MEMORY.md` index and the `.workspace` marker are filtered out: the index is rewritten alongside nearly every topic change and would double every row.
- Changes made through an opaque `exec_command` shell carry no structured signal and are not listed, matching the file-summary card's existing limitation. Root-session Tasks only; a subagent's memory writes belong to that child's own Agent.
- Streaming replies never flash the memory displays: re-derived but unchanged rows keep their identity, so the listing and an open detail only refresh when a settled Task actually changed memory.
- Memory management (add / edit / delete) stays on the agent-settings memory tab; the panel's list header links there. On narrow viewports the panel rides the same bottom Sheet as its siblings; switching conversations resets it to the list.
