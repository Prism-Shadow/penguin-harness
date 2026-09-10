# The sidebar lists every Workspace, not only the ones its first pages touched

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#663](https://github.com/Prism-Shadow/penguin-harness/pull/663)

[中文版](2026-09-10-sidebar-workspace-groups-complete.zh.md)

Grouped by Workspace, the sidebar formed a group only for Workspaces that one of its loaded rows belonged to, and the initial load is each Agent's ten newest conversations. With dozens of Workspaces holding hundreds of conversations each, a Workspace whose newest conversation was older than an Agent's ten newest never appeared at all. The group list is now built from the server's per-Workspace counts as well: every Workspace that holds Sessions is a group, and the groups are placed by their newest Session whether or not any of its rows are loaded.

## Details

- The session list's `counts=1` response carries `workspaceLatest` beside `workspaceCounts`: each Workspace path's newest Session `createdAt`, taken in the same newest-first walk.
- A group known from the counts alone starts empty and asks for its own first page when its page of groups is on screen, as every group already did for its missing rows. While that page is on its way the group shows a loading skeleton, not "no conversations"; a failed fetch leaves the reveal row as the retry.
- Ordering: the newer of a group's newest loaded row and the server's stamp, temporary Workspaces merged last, manually-added empty Workspaces behind them — so a group does not move when its rows arrive.
