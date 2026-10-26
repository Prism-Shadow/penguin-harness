# A TokenDance authorization redirects back to the port the Web App is on

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[中文版](2026-10-26-oauth-callback-port.zh.md)

Connecting TokenDance from the Models page sent the browser, once authorized, to `http://localhost/api/projects/<project>/model-oauth/callback?…` with no port, so the redirect never reached the App, in a browser and in the desktop app alike. The start request rides the Web App's API socket, and every call on that socket was addressed to a fixed `http://localhost` instead of the address the page was opened on; the server built the callback address from it.

Calls on the API socket are now addressed to the origin the page opened the socket on, as an HTTP request is: its host and port, under the scheme a trusted proxy (`PENGUIN_TRUST_PROXY=1`) reports. The authorization returns to the App's own port. A Web App opened over plain HTTP on a LAN address goes straight to the one-time code step again, which the same fault had turned back into a redirect to `localhost`.
