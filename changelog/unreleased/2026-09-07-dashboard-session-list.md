# The dashboard's counts unfold into the Sessions they count

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `web`, `server`

[中文版](2026-09-07-dashboard-session-list.zh.md)

The dashboard's **to review** count used to include subagent Sessions, which the sidebar keeps in a folder closed by default — so opening every visible Session never brought it down. Subagent Sessions are now left out of both counts: they belong to the conversation that spawned them, which is the row a person opens. A count of zero is no longer shown, on a row or in the header.

## Details

- Tapping a row's count unfolds the Sessions behind it, one line each: the sidebar's glyph, the title truncated to the line, and the id's short tail. Tapping a line opens that conversation, marks it read, and makes its Agent current — including for a Session on another machine.
- `GET /api/projects/:projectId/sessions/overview` now carries each Session's Agent, its title when one exists, and its origin (`schedule` / `subagent`), the same origin the sidebar's folders are decided by.
