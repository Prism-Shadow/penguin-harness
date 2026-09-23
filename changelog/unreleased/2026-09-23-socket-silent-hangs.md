# A request the socket never answers is given up on, and says why

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#832](https://github.com/Prism-Shadow/penguin-harness/pull/832)

[中文版](2026-09-23-socket-silent-hangs.zh.md)

A conversation could stay blank until the page was reloaded, with nothing to show for it:
no error on screen, nothing in the console, no failed request in the network log. Every
API call rides the one socket (PRFC-0011), and the socket client waited without limit —
on a handshake that neither opened nor failed, on a call the server never answered, on a
stream the server never opened — while the server's heartbeat kept the connection looking
alive. The same silence held the Session list on its skeleton when this server answered
none of a reload's requests: nothing asked again until some event happened to fire.

The warnings then named the cause: after a hot push, a socket opened on the previous App
kept dispatching into it. Its `fetch` was that App's routes, bound at the handshake, and the
disposed tree had handed its machine sessions to the successor — so every call through a
machine (`/server/<machine>/…`, which is where an organization's desks and channels live)
never answered, while this server's own routes still did and the heartbeat kept the
socket looking healthy. The browser did not reconnect because the socket never closed.

## Details

- The API socket is served by the platform shell, and every call on it enters the App of
  the moment: a plugin change re-assembling the App under an open socket no longer strands
  it. A push replaces the shell itself, so the open sockets are handed to the successor,
  which closes them (close code 1012, "the harness was updated; reconnect") two seconds
  after it is up — after the runtime has re-pointed its own tree, which a handshake in that
  window used to read disposed. The browser's socket client then reconnects and re-issues
  its streams from their last event ids. The first push that carries this change is still
  swapped out by the previous platform, so windows open at that moment need one reload;
  every push after it reconnects on its own.

- A handshake still not open after 10 s is closed by the client and tried again; three in a
  row give the socket up for EventSource and fetch, as refused handshakes already did.
- A one-shot call unanswered after 20 s is given up on with a `console.warn` naming the call
  and the socket's state (open, and how long ago its last frame came). A read (`GET`/`HEAD`)
  is then made over HTTP; a write is reported as a network error, since it may have landed.
- A stream not opened within 20 s is cancelled and issued again, with the same warning.
- A Session-list reload this server answered nothing to is tried again on a backoff (2 s
  doubling to 30 s), with a warning listing the answers it got.
- A conversation whose history is still loading after 15 s logs where the call went (this
  server or which machine) and what the socket is doing, so the next report can name the cause.
