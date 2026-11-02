# Close API sockets when their login expires or is revoked

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1373](https://github.com/Prism-Shadow/penguin-harness/pull/1373)

[中文版](2026-10-27-socket-login-lifetime.zh.md)

API sockets remain bound to the login used for their handshake. Password resets, logout and login expiry prevent further calls and stream delivery on that connection. The next incoming call, outgoing event or heartbeat closes the invalid socket and releases its requests. A fresh login can reconnect normally.

Checking an open connection does not extend its login expiry.

Revoked logins were rejected before dispatch into a disposed App. After the App was rebuilt, a fresh login could open a new socket normally.
