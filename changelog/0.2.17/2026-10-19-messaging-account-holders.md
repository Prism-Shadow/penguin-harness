# A messaging bot can be checked against every server before it is turned on

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1218](https://github.com/Prism-Shadow/penguin-harness/pull/1218)

[中文版](2026-10-19-messaging-account-holders.zh.md)

A server already refused to enable one bot account on two of its own Sessions. Two new routes extend that check to the server and the machines it connects, so a client can see where a bot is enabled before turning it on, and keep one bot on one server at a time.

## Details

- `GET /api/messaging/accounts` (admin only) lists every bot account the server has enabled, across its Projects, as `{channel, accountId}` pairs. It names no Session and carries no secret, and a binding whose Session no longer exists does not count.
- `GET /api/projects/:projectId/messaging/account-holders?channel=&accountId=` answers which servers have that account enabled: this server (`machineId: null`), and each machine the Project uses that says it does. Machines that could not be asked are listed in `unreachable` with a reason: `not_connected`, `older_build` (the machine answered 404 because its build predates the route) or `failed`. Any Project member may ask; the machines are asked only when an admin asks.
- The Server API page documents both routes under "Bot accounts across servers", and says that a Session on a machine keeps its bindings on that machine and connects from there.
- New server suites cover the two routes with a machine app and the server that connects it, and show that a machine's Session answers its bot while the connecting server cannot reach the machine.
