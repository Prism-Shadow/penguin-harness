# Settings › Storage shows what the data root holds and cleans what can be regenerated

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`, `docs`

[中文版](2026-11-19-storage-settings.zh.md)

Settings gained a **Storage** page after Archived chats. It shows the space the data root uses in eight categories, per Project and per agent. It removes the scratchpads, temporary Workspaces and caches that are safe to remove after the user has reviewed them, and lists Sessions by size and age so their Traces can be deleted. A member sees and cleans the Projects they can open. An admin also sees and cleans the whole data root.

## Details

- **Measuring.** The server measures in the background, one unit at a time: each Project's folder, and the server's own top-level entries. The walk shares the background Agent purge's throttle, with at most two filesystem calls in flight, and never follows a link. The figures are held in memory with the time they were measured. The page shows that time, polls while a measurement runs, and has **Refresh**. A measurement already under way is joined, never started twice.
- **Categories.** Every byte falls in exactly one category:
  - Traces;
  - Agent State (`agent_state/`, `agent_state.git/`, `snapshots/`);
  - temporary Workspaces;
  - scratchpads;
  - caches (an agent's `shared_env/` and the root's `.cache/`);
  - logs;
  - plugins;
  - other.
  An admin also sees the Projects they cannot open as one sum, with no names, and each top-level entry of the root. The cache folders are one table in the server (`packages/server/src/storage/layout.ts`). A new cache folder, such as a workbench's cache, is counted and can be cleaned once it is added there.
- **Cleanup is review-then-delete.** The review lists only what is safe to remove right now:
  - **Orphan scratchpads**, ticked: no index row and no Trace names the Session, and nothing under the folder changed for a day.
  - **Idle Sessions' scratchpads**, unticked: the Session is in a list, not in use, and was last active more than the days chosen (7 by default). Its chat's attached images stop showing once the scratchpad is removed.
  - **Orphan temporary Workspaces**, ticked: no Session of any Project has the folder, a folder inside it, or the agent's own folder or `workspaces/` as its Workspace, and nothing under it changed for a day. A temporary Workspace that a Session still has is never offered.
  - **An agent's tool environments** (`shared_env/<name>/`), unticked: offered while none of its Sessions is in use.
  - **The server's `.cache/` entries**: offered to admins only.
- **Removal.** Each item is judged again and moved aside with one rename in the same synchronous step, so a Task that starts afterwards never writes into a folder being removed. An agent-level folder moves into `agents/.deleting/`, which the server already resumes removing at the next start. A server cache moves into the cache's own `.deleting/`. "In use" means any of these: a Task or a compaction is running, input is queued, a background process or subagent is still running, or the Session is being deleted. The session runtime answers this through the new `sessionInUse` and `agentInUse`.
- **Traces.** The Sessions of the user's Projects are listed by size (Trace files plus the measured scratchpad) or by last activity. The list filters by agent, archive state and age, and holds up to 500. Running Sessions are marked and cannot be chosen. **Clean up old chats** opens the list preset to archived Sessions older than 30 days. Deleting goes through the archive page's existing batch delete, so a Session's subagents, scratchpad and drafts go with it. **Archived chats** opens that page.
- **Routes.** New routes are `GET /api/me/storage`, `POST /api/me/storage/refresh`, `GET|POST /api/me/storage/cleanup`, `GET /api/me/storage/sessions` and `POST /api/me/storage/reveal`. The last one shows the data root or a Project's folder from the desktop app's own window.
- **Shared UI.** The shared UI package gained a stacked usage bar with its legend and a review-then-delete list. Each has a gallery board, and the gallery mocks every new endpoint.
- **Docs.** Settings and Server API pages describe the page and its routes.
