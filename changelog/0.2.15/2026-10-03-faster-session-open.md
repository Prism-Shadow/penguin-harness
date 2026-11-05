# A historical conversation opens without waiting for the sidebar

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#984](https://github.com/Prism-Shadow/penguin-harness/pull/984)

[中文版](2026-10-03-faster-session-open.zh.md)

Opening a conversation no longer queued behind the sidebar's Session list. The chat page looked up the routed Session right away, and the sidebar asked each server for all of its pages in one request instead of one request per Agent and page.

## The conversation no longer waits for the sidebar

- The chat page's direct lookup of a routed Session stopped waiting for the Session list to finish loading. That list fetched one first page per Agent per connected machine before the conversation the reader asked for.
- A lookup that failed while the list was still loading was no longer taken to mean the Session was gone: the route stayed pending and the lookup ran once more when the list settled. A lookup that failed after the list had settled still meant gone, also when it had been sent while the list was loading.
- One lookup per Session was in flight at a time. The page used to cancel and re-issue it on every list change, which sent a dozen identical requests for one deep link. An answer about a Session the route had already left was dropped.

## The sidebar's list fan-out became one request per server

- Added `POST /api/projects/:projectId/sessions/batch`, which carried up to 256 entries in one request, each asking for one page of one Agent's list. An entry took the parameters of `GET /api/projects/:projectId/agents/:agentId/sessions` and was checked by the same rules; one malformed entry made the whole request a 400. `reload()` and `loadMoreFor()` both used it, so Workspace grouping's per-group pages went out as one request per server too.
- Answers stayed per Agent: an Agent the server did not host came back as `reason: "absent"`, and a failure to answer as `reason: "error"`, so a failure was never read as "no conversations".
