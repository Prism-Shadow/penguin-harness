# The server routes a machine's Session by its id

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1284](https://github.com/Prism-Shadow/penguin-harness/pull/1284)

[中文版](2026-10-22-session-routing-by-id.zh.md)

A Session on a connected machine can now be reached at `/api/sessions/:sessionId/…` on this server, without the `/server/<machineId>` prefix: the server finds the machine that holds the Session and forwards the request there. This is for admins only, like the prefix, which keeps working unchanged. The Web App still uses the prefix for now.

## Details

- The server keeps an in-memory index from Session id to machine. It learns entries from the machines' `session_created` and `session_deleted` events. For an id it has not seen, it asks every connected machine of the caller's Projects at the same time, and the first machine to answer holds the Session. An id that every machine denies is remembered as unknown for 10 seconds. The index starts empty after a restart or a hot push.
- A Session in this server's own index is always answered here, even when a machine holds the same id. A caller who is not an admin gets the usual `404` `session_not_found`.
- A request is forwarded with the same identity and header rules as the `/server/<machineId>` proxy, and streams ride the machine's socket in the same way, over HTTP and over the API socket.
- New answers: `503` `not_connected` with the machine's `machineId` and `alias` in `details` when the machine holding the Session is not connected, and `502` `machine_refused` when that machine refuses this server's session. A machine's refusal is never passed on as a `401`.
- The server API docs describe the routing.
