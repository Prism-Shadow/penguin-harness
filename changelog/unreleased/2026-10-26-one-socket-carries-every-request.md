# One socket carries every request and never gives up

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1365](https://github.com/Prism-Shadow/penguin-harness/pull/1365)

[中文版](2026-10-26-one-socket-carries-every-request.zh.md)

A page now carries every request outside the small set that always travels over HTTP on its one
API socket: a call made while the socket is closed waits for the next handshake and goes out
when it succeeds, and the client reconnects on its own backoff for as long as a call or a
stream still needs it.

## Details

- The client no longer stops connecting after a counted number of failed handshakes. Every drop
  — a connection that was up and went away, a handshake that never opened, a server that could
  not be reached — schedules the next attempt on the one exponential backoff (1 second,
  doubling, capped at 30 seconds), and scheduling stops only once nothing is left to carry; the
  next call or stream opens the socket again. A failed handshake advances that backoff by one
  step, so four failures in a row retry after 1, 2, 4 and 8 seconds. `unavailable` now has one
  source only: a page without `WebSocket`.
- The API client no longer falls back to HTTP per call. Apart from the `httpOnly` paths
  (`/api/me`, auth, `sessionKindPath`, hmr, install), a call joins the socket's queue and is
  sent in order once a handshake succeeds. A call or stream arriving during a wait starts no
  handshake of its own; it waits for the attempt the drop already scheduled.
- The queue belongs to one generation of identity. Signing in, signing out, this server's
  session being judged expired, and `/api/me` reporting a different user than last time all move
  to a new generation, and calls queued under the old one end with `identity_changed` instead of
  going out under the next user; a repeated confirmation of the same user keeps the queue. An
  answer from an identity probe still in flight does not open the old identity's socket — the
  identity is asked again instead. The whole queue is refused when the identity changes, the
  page has no `WebSocket`, nobody is signed in, the identity probe fails, or constructing the
  socket throws.
- An answer the socket hands back is judged by `content-type` the way one read off a `Response`
  is: a text body whose `content-type` does not contain `json` is reported as not the server's
  answer — `text/html` as a page, 502, 503 and 504 as a proxy, any other type by its type — and
  is not given to the caller as data. A body marked `json` comes back parsed, or as its raw text
  when it does not parse; an empty body keeps its status and `null`. A socket answer carries no
  proxy header, so the gateway case rests on the status alone.
- A batch handed to the socket settles entry by entry. A body that cannot be serialized ends
  only that entry (`socket_unserializable`), and a send that throws rejects that entry and
  closes the socket for the reconnect; the entries after it get their turn as usual. A stream
  frame that cannot be sent goes back to the streams waiting for a socket, and the reconnect
  issues it again.
- The stream's transport, protocol and server are untouched, callers add no `await`, and no
  `online`, `focus` or `visibilitychange` listener was added. The answer deadline moved from the
  call path into the send path with the same kind and count. The queue has no upper bound and no
  cancel before send.
