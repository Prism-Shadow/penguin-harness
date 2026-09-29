# Machines: the hop to a machine answers before the browser gives up

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#PR_NUMBER](https://github.com/Myriad-Dreamin/penguin-harness/pull/PR_NUMBER)

[中文版](2026-09-28-machine-hop-answers-in-time.zh.md)

A request this server forwards to a machine (`/server/<id>/api/…`) no longer waits forever when that machine is not serving. When the machine's server is not listening, the request fails at once and says so. When the ssh session has stalled, it fails within 8 s, naming the SOCKS layer. A read the machine accepts but never answers gets a 504 after 15 s. Before, such requests could hang with no answer. The browser gave up on them after 20 s and sent them again over HTTP, and those retries hung as well until Chromium refused every new request with `ERR_INSUFFICIENT_RESOURCES`.

## Details

- Every TCP connection to a machine is a SOCKS CONNECT through its ssh session's `-D` port. When nothing listens on the port on the far side, OpenSSH sends no failure reply: it closes the connection. The dial ignored a close that came before the reply, and its handshake timer stopped with the socket, so the dial never settled. It now fails at once with "the session closed the channel to 127.0.0.1:<port> before answering — nothing is listening there, or the session is going down". Stream relays and one-shot forwards both show that sentence.
- The SOCKS handshake deadline is 8 s (was 20 s). A stalled session now fails with "the session's SOCKS handshake timed out" before the proxy's own deadline, and well before the browser's 20 s.
- A forwarded GET or HEAD that has no response headers after 15 s (dial included) is answered `504 machine_not_answering`. The upstream request is dropped, and the machine list records the failure in its `api` fact. Writes are not cut: a write may rightly take long, and cutting one would make the browser repeat its effect.
- An answer that has started is not affected: once its headers arrive, the body streams with no deadline.
