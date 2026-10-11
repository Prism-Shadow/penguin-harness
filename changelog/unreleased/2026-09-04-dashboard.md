# A dashboard for a phone: where work runs, and where a person is needed

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#815](https://github.com/Prism-Shadow/penguin-harness/pull/815), [#618](https://github.com/Prism-Shadow/penguin-harness/pull/618), [#643](https://github.com/Prism-Shadow/penguin-harness/pull/643)

[中文版](2026-09-04-dashboard.zh.md)

A new page, reached from the user menu under **Settings**, that fits a phone and answers one question: which Workspaces have Sessions running right now, and which have a Session finished since you last opened it — the sidebar's green dot, counted. One row per Workspace with two counts, and the header repeats the totals. A count of zero is not shown.

## Details

- Tapping a count unfolds the Sessions behind it, one line each: the sidebar's glyph, the title truncated to the line, and the id's short tail. Tapping a line opens that conversation, marks it read, and makes its Agent current — including for a Session on another machine.
- Subagent Sessions are left out of both counts: they belong to the conversation that spawned them, which is the row a person opens. An organization's Sessions are left out too, by the same rule the sidebar's list uses, so every Session the page counts is one the sidebar shows.
- A browser that opens the dashboard before any conversation starts the Project's read markers there: Sessions that finished earlier count as read, as they do once a first conversation has been opened.
- Every server the Project's Sessions live on is asked: this one, and each machine this server holds a connection to. A row from another machine carries that machine's name. An installed machine with no connection, and one that does not answer, is counted in a note above the list rather than dropped silently; a machine that has not answered within ten seconds counts as not answering, so it never holds up the next refresh. Without the right to list machines, the page reads this server only.
- The auto-created temporary Workspaces merge into one row per machine, as the sidebar groups them.
- Rows that wait on a person come first, then the busiest. The page refreshes every fifteen seconds while open and again when its tab comes back.
- `GET /api/projects/:projectId/sessions/overview` returns every non-archived Session of the Project over every Agent — its Agent, Workspace, status, whether it ever ran, when it last did, its title and its origin. Read versus unread is a per-browser marker, so the page does the counting.
- A Session opened in another tab or window of the same browser is read here too, in the sidebar and on the dashboard. Where the browser refuses to store the read markers (private mode, a full quota), the ones held in memory are kept when the tab comes back instead of lighting up unread again.
