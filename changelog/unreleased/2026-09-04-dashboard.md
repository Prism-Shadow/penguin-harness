# A dashboard for a phone: where work runs, and where a person is needed

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#618](https://github.com/Prism-Shadow/penguin-harness/pull/618)

[中文版](2026-09-04-dashboard.zh.md)

A new page, reached from the user menu under **System settings**, that fits a phone and answers one question: which Workspaces have Sessions running right now, and which have a Session waiting on an approval. One row per Workspace, two numbers per row, nothing else — no Session list, no titles, no controls. The header repeats the two totals.

## Details

- Every server the Project's Sessions live on is asked: this one, and each machine that can be reached. A row from another machine carries that machine's name. A machine that does not answer is counted under the list rather than dropped silently.
- The auto-created temporary Workspaces merge into one row per machine, as the sidebar groups them.
- Rows that wait on a person come first, then the busiest; the page refreshes itself every fifteen seconds while open.
- The server answers `GET /api/projects/:projectId/sessions/overview` with the per-Workspace counts over every Agent of the Project: a Session counts as running while its status is not idle, and as pending review while an approval awaits a decision. Archived Sessions are not counted.
- The page is not in the sidebar's nav group; its row sits directly under System settings in the user menu.
