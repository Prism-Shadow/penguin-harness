# The Session list learns of Sessions it did not make, on this server and on machines

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#557](https://github.com/Prism-Shadow/penguin-harness/pull/557)

[中文版](2026-08-30-sessions-list-live.zh.md)

A Session started by the CLI (or by another tab, a schedule, an agent spawning a child) did not appear in the list until the page was reloaded, and a Session running on a machine kept whatever status the last fetch had returned — often "running" long after it had stopped, discovered only by opening it.

## Details

- The server now announces every Session creation on the user channel (`session_created`, to the Project's owner and members), and a title set through `PATCH /api/sessions/:id` — the CLI's `--title`, a rename from another tab — the same way a generated title already was (`session_title`). Until now only a schedule firing was announced, which is why a scheduled Session appeared at once and a CLI one did not.
- The list reloads on `session_created`: a row it did not make can only be fetched, not conjured, since a row needs its title, Workspace and counts.
- The list now opens the user event stream of **each reachable machine** as well as this server's, through the same-origin proxy. A Session on a machine changes state on that machine's server, and only its stream says so; the list was assembled from every machine but listened to one. Streams follow the reachable set — closed for a machine that drops out, opened for one that comes up — and a machine's `web_updated` is ignored: that is the machine's web, not this window's.
