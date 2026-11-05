# Host commands move below the hot seam

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `server`

[中文版](2026-09-07-host-commands-ship-by-push.zh.md)

`/api/command` was mounted above the platform's HTTP seam, which made it runtime code: its shape could only change by rebuilding and redeploying every installation. That is what the runtime layer is not for — it carries mechanism, and what a host command is, what it is called and who may run it is policy.

It is now served by the platform, so it ships by push like every other business API. What stays in the runtime is the message port itself: the last frame the host sent is published as `platform.shellFrames`, unread, and the platform interprets it. The frame has to be published rather than held by the platform because the host announces itself once per wiring — a platform holding it in its own memory would lose it at the next push and never be told again.

The other compatibility path is in the pushable half too: a runtime older than the holder is read through its own service instead. The runtime does not keep its own copy of the routes — a platform too old to take the `/api/command` prefix simply has no host-command route at all.
