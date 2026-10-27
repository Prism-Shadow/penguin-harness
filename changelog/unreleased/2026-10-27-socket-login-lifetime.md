# Close API sockets when their login expires or is revoked

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-27-socket-login-lifetime.zh.md)

API sockets remain bound to the login used for their handshake. Password resets, logout and login expiry prevent further calls and stream delivery on that connection. The next incoming call, outgoing event or heartbeat closes the invalid socket and releases its requests. A fresh login can reconnect normally.

Checking an open connection does not extend its login expiry.
