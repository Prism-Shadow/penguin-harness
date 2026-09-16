# Company mode's Sessions stay out of the development list

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#751](https://github.com/Prism-Shadow/penguin-harness/pull/751)

[中文版](2026-09-16-org-sessions-out-of-the-development-list.zh.md)

While an organization was working, its Sessions could surface in development mode's Session
list. Once an employee held more Sessions than the list loads per page, the server's totals
still counted the desk and ticket sessions the list had not loaded, so the list drew their
Workspace as a group — placed at the top by the Session that had just opened — with a reveal
row that revealed nothing; and a sub-session an employee spawned carried no organization mark
at all, so it listed under the Subagents folder like any other conversation. The list now asks
the server for the user's own rows only, and a sub-session inherits its parent's stamp.

## Details

- `GET /api/projects/:projectId/agents/:agentId/sessions` accepts `excludeOrg=1`: the rows an
  organization owns — its desk and ticket sessions and the sub-sessions they spawned, by the
  durable `client: "org"` stamp or by the organization caches — leave the page, the `counts=1`
  totals, the per-Workspace breakdown and the Workspace stamps together, and paging walks the
  filtered stream. Without the flag the route keeps serving every row, whichever client
  created it. The Server API reference documents the flag in both languages.
- A sub-session registered under a Session stamped `client: "org"` is inserted with the same
  stamp; one registered under any other Session keeps the blank marker it always had.
- The Web App's session list store passes `excludeOrg` on every fetch and no longer corrects
  the server's totals on its side; a row that still enters through the chat page's deep-link
  self-heal is dropped at render and leaves the totals alone.
- The store remembers every run status the user channel reports (`session_state`), whether or
  not a loaded page holds the row, and company mode's desk rows, org chart and overview read
  those — so a desk past the first page of an employee's stream shows its run ending too.
- `GET /api/projects/:projectId/organizations/:orgId/sessions` marks a desk whose Session has
  an enabled messaging binding with `messagingChannel`, read as the Session's own row reads it.
  The company sidebar's desk rows draw their messaging mark from it — every bound desk, where
  the mark used to come from whichever desks the development list happened to hold — and a
  bind or unbind from a desk's row menu updates the row at once.
