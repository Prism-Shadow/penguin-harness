# The API socket has its own route

- **Date:** 2026-10-20
- **Type:** refactor
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1272](https://github.com/Prism-Shadow/penguin-harness/pull/1272)

[中文版](2026-10-20-api-socket-own-route.zh.md)

The API socket moved out of the terminal stream's namespace. It has one upgrade route of its own, `GET /api/socket`, whose cookie names the user and which never touches the terminal manager, so no terminal is created, listed or looked up on the way.

## Details

- `apiSocketPath()` takes no argument and returns `/api/socket`; `API_SOCKET_ID_PREFIX` is gone. The runtime's upgrade handler routes the path itself, authenticates the session cookie and checks the Origin as for a terminal stream, then hands the platform a reference naming the user whose cookie passed — the same `attachStream` both transports use.
- The platform serves the protocol as before: every call enters the App of the moment through `Http.fetchAs`, a stream answer becomes `stream`, `event` and `end` frames, and a hot update under an open socket stays invisible to it.
- The Web App spells the socket's address from `apiSocketPath()`. Who the socket opens as is its cookie, so nothing in the page's path is keyed to a user id any more, and no terminal id exists for a client to forge.

## Compatibility

- No release opened the API socket at the old path: the socket ([one API socket per tab](2026-09-07-single-socket.md)) first ships in 0.2.17, at `GET /api/socket`. Only builds of `main` between [#912](https://github.com/Prism-Shadow/penguin-harness/pull/912) and this change used `GET /api/terminals/api-socket@<userId>/stream`.
- That path is no longer an upgrade route: the terminal stream handler treats the id as an unknown terminal and refuses the handshake with `404`. A client that hard-coded it asks `apiSocketPath()` in `@prismshadow/penguin-server/api` instead.
- A machine on 0.2.16 or earlier has no API socket at either path; updating the machine to 0.2.17 gives it the socket.
