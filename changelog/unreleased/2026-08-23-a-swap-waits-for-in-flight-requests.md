# A platform swap waits for the requests already inside the tree

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#424](https://github.com/Prism-Shadow/penguin-harness/pull/424)

[中文版](2026-08-23-a-swap-waits-for-in-flight-requests.zh.md)

The stop-the-world protocol only ever gated one direction. A request arriving while a swap
was running waited it out, but a request that had already passed the gate had nothing
holding the swap off — an upgrade landing a microtask later disposed the App that request
was standing in, and the handler finished against a closed manager and a released
current-App pointer. A busy installation is exactly where that window is widest, and it was
reported as whatever the half-stopped App happened to throw.

The terminal WebSocket handshake did not gate at all: it resolved the platform instance
directly, so a handshake landing in the swap window bound the socket through a dead
generation's stream binding.

Both now take a ticket on the running instance, and a swap waits for the outstanding tickets
before it disposes anything.

## Details

- The ticket covers reaching into the tree, not the response's lifetime — a streaming
  handler hands back its Response as soon as the stream exists, so an open SSE subscriber
  does not hold a swap.
- The wait is capped at five seconds and then proceeds with a warning naming the count still
  outstanding: a handler that never returns must not be able to hold the upgrade channel
  shut, since pushing a new platform is how such a handler gets fixed.
