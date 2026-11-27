# A socket that arrives while the server starts or swaps no longer ends the process

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1909](https://github.com/Prism-Shadow/penguin-harness/pull/1909)

[中文版](2026-11-26-boot-race-no-crash.zh.md)

A browser tab left open on a previous server reconnected its API socket while a fresh root was
still starting, and the server process exited with `no api 'Auth' on module 'IdentityModule'`. The
admin seed provisions `default_project`, whose preinstalled modules re-assemble the App, and the
WebSocket handshake read the Auth node from a tree that the re-assembly had already disposed. The
throw came out of an `upgrade` listener, where nothing catches it. A single upgrade request whose
target is not a URL (`GET http://[ HTTP/1.1`) ended a running server the same way.

## Details

- Until its startup has finished, the admin seed included, the server answers every path with
  "starting". A request gets the 503 with `retry-after`, and a WebSocket handshake is completed
  and closed at once with 1013 (Try Again Later). The App's routes and upgrade listeners are
  attached only after the seed.
- While a push or a re-assembly has the running tree disposed, the entry authenticates handshakes
  and re-checks an open API socket's login with the Auth node it resolved last. The HTTP surface
  already did this.
- A failure in the handshake of a terminal stream or the API socket is logged and refused with a
  500. A request target that is not a URL is refused with a 400. An API socket whose login check
  throws is closed with 1011. None of these ends the process.
