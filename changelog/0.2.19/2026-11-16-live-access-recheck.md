# Open Session streams and the API socket re-check access

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1359](https://github.com/Prism-Shadow/penguin-harness/pull/1359)

[中文版](2026-11-16-live-access-recheck.zh.md)

An open Session stream (`/stream`, `/amsp` and the Agent API's `/amsp/v1/sessions/:id/stream`, over HTTP or the API socket) re-ran its route's access check on every heartbeat, as it already re-checked its login. A member taken off the Project, an Agent API key deleted, keyless access turned off, or the Agent or server API disabled ended the stream within one beat; other readers stayed connected.

An API socket stayed bound to the login its handshake authenticated. Once that login was gone — signed out, reset by an admin, or expired — the socket's next call or next heartbeat closed it with code `1008` and released its calls; a fresh sign-in connected again. Asking did not extend the login.
