# Close API sockets when their login expires or is revoked

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1373](https://github.com/Prism-Shadow/penguin-harness/pull/1373)

[中文版](2026-10-27-socket-login-lifetime.zh.md)

The API socket rechecks the original login after a platform reload and before sending a response or starting a subscription. Existing subscriptions also check access on their heartbeat. These checks do not renew the login.
