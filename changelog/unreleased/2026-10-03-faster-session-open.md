# Faster opening of a historical conversation

- **Date:** 2026-10-03
- **Type:** performance
- **Scope:** `server`, `web`

[中文版](2026-10-03-faster-session-open.zh.md)

Opening a conversation was serialised behind the sidebar's Session-list fan-out.

## The conversation no longer waits for the sidebar

- The chat page's direct lookup of a routed Session no longer waits for the Session list to finish loading. The list fans out one first page per Agent per connected machine, and that work used to sit in front of the conversation the reader asked for.
- A lookup that fails while the list is still loading is no longer treated as "this Session is gone": the route stays pending, the lookup runs once more when the list settles, and only a second failure redirects.
- One lookup per Session is now in flight at a time. The effect used to re-run (and cancel, then re-issue) on every list change, which fired a dozen identical requests for one deep link.

## The sidebar's list fan-out is one request per source

- Added `POST /api/projects/:p/sessions/batch`, which answers every (Agent, page) pair the sidebar wants in one round trip instead of one request each. Workspace grouping asked for a second wave of per-group, per-Agent pages; both paths use it now.
- Answers stay per Agent: a 404 means "this server does not host that Agent" (`reason: "absent"`) and anything else means it failed to answer (`reason: "error"`), so a failure is never read as "no conversations".
