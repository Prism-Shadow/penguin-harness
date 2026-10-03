# Sidebar lists page by last activity and only ever append

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `web`, `server`, `ui-gallery`

[中文版](2026-10-03-sidebar-activity-paging.zh.md)

In the sidebar's time grouping, "Load more chats" stopped moving rows from "Earlier" up into "Past day". The list was displayed by last activity but paged by creation time, and each Agent was paged on its own, so a later page could hold rows that belonged above rows already on screen. Every sidebar list was made to page in its display order, and a list merged from several streams to show only the rows all of them had reached. The same fix applied to the Agent and Workspace groupings and to the Subagents / Scheduled / Evaluations / Archived folders.

## Details

- `GET /api/projects/:projectId/agents/:agentId/sessions` gained `order=activity` (`lastActiveAt` descending, ties by `sessionId` descending, both compared by code point) and `before=<lastActiveAt>,<sessionId>`, which returns the rows strictly below that key. `before` required `order=activity` and `limit` and could not be combined with `offset`; a malformed value was answered with a 400. Without `order` the list kept its creation order and offset paging, and `counts=1` totals still covered the whole list.
- The Web App requested every sidebar page with `order=activity` and continued each one from the key of the last row shown. A Workspace group's first page of its own continued from its Agent's cursor on that machine, and was skipped when that Agent's list was already exhausted.
- Each list the sidebar drew — time mode before bucketing, each Agent and Workspace group, and each folder — was cut at its watermark: the most recent cursor among the streams (Agents, machines) that still had more. Rows below it stayed in memory until a later page lowered the watermark, so "Show N more chats" and "Load more chats" only added rows below the ones shown. The open conversation always showed, and a search still covered every loaded row. The folders were ordered by last activity instead of creation time.
- The `session_state` user-channel event gained `projectId`. A Session of the current Project that the list did not hold was fetched once from the machine that announced it and shown at the top, with the newest state applied; flips of one run shared one lookup, and organization rows and deleted or missing Sessions were not asked about again.
- The gallery's mock list route was given the same `order` and `before` handling.
