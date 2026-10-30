# Recheck access on live Session subscriptions

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1359](https://github.com/Prism-Shadow/penguin-harness/pull/1359)

[中文版](2026-10-26-session-stream-access.zh.md)

Session subscriptions now recheck access before sending events and on each heartbeat, over HTTP and the API socket. Removing a Project member ends their existing subscriptions. Agent API subscriptions also end when their key is deleted, keyless access is turned off, or the Agent or server API is disabled. Other authorized subscribers remain connected.
