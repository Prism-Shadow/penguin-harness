# A window whose session was revoked lands on the sign-in page by itself

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#819](https://github.com/Prism-Shadow/penguin-harness/pull/819)

[中文版](2026-09-21-revoked-session-lands-on-login.zh.md)

Resetting a user's password dropped every session row they held, as the Admin page promises — but a window that already had the app open stayed on it. An SSE stream was authorised once, when it connected, and nothing ever checked it again; the Web App kept a single user stream for the whole login session and reported nothing when it died. The window went on streaming until its reader happened to make a request. The server now ends a revoked user's open streams, and a window that loses its stream — or simply comes back to the foreground — asks whether it is still signed in.

## Details

- The server tracks every open SSE stream by the user it was authenticated as (`LiveStreamRegistry`, registered and released by the stream itself). `AdminService` ends that user's streams in the same step as it drops their session rows, on both password reset and account deletion.
- Each stream re-checks its own session on its 20s heartbeat and ends when the row is gone or has expired — the catch-all for session rows dropped without going through the registry. The check reads the row by its token hash and never renews it, so a window left connected cannot keep itself signed in by doing nothing.
- A stream authenticated by the boot's local API token (the CLI, an Agent's own tools) carries no session row and is left alone.
- The Web App's app-wide user stream probes `GET /api/me` when the browser closes the connection for good, the way the chat page's Session stream already did; both now call one helper, and a 401 goes through the api client's global handler that clears the user and routes to the sign-in page.
- The same probe runs when a window regains focus or becomes visible, so a tab left open overnight does not linger on a dead page, and the terminal list's poll hands a 401 to it instead of quietly keeping its last known list. Concurrent probes share one request.
- The server API reference's SSE delivery guarantees record the heartbeat's session re-check and what ends a stream.
