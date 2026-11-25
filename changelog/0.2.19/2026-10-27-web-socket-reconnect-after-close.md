# The API socket stops reconnecting for streams that have closed

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1370](https://github.com/Prism-Shadow/penguin-harness/pull/1370)

[中文版](2026-10-27-web-socket-reconnect-after-close.zh.md)

When the Web App's API socket drops, it books a reconnect to bring its parked streams back. Closing the last of those streams now cancels that reconnect, so a page that unmounted while the socket was down no longer asks who is signed in or opens a socket after it has gone. The next stream opens the socket again on its own.
