# The Web App holds one socket to its server, and every stream is a call on it

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-07-single-socket.zh.md)

The Web App opened one never-ending HTTP response per long-lived subscription — this server's `/api/events`, one `/server/<id>/api/events` per connected machine, and one Session stream per open chat — and browsers allow six HTTP/1.1 connections per host, so a few machines and one chat left the page's own requests queued behind them, and a proxied stream that died half-way never gave its slot back. Now a tab holds one WebSocket to its server and everything long-lived is a call on it; the server holds one socket per connected machine and relays their streams over it. Design: PRFC-0011.

## Details

- `GET /api/socket` (Upgrade) is a second transport of the same API: each text frame is a call to an existing endpoint — method, path, a whitelisted header (`last-event-id`, `accept`, `content-type`), a JSON body — dispatched through the same entry HTTP requests take, so authorization, validation and error shapes are the endpoint's own. A `text/event-stream` response comes back as a `stream` frame, one frame per event, then `end`; a `cancel` frame releases it. The handshake is gated on the session cookie or the local API token and same-origin, and every call is re-authenticated by the app from the same headers. The socket pings on the SSE heartbeat's cadence and terminates a peer silent for two beats; a client lagging past the send watermark has its stream ended with reason `lagging` rather than buffered without bound. `/api/hmr/*` and the socket itself never ride it.
- The machines proxy relays a stream request (`accept: text/event-stream`) over one socket it holds to that machine (dialled through the machine's ssh session as its admin), turning the frames back into a `text/event-stream` response; a machine whose build has no socket is remembered briefly and gets the HTTP forward as before.
- The web's `apiFetch` sends a call over the socket when it is open and fetches otherwise, through one code path; a response the socket declines to carry (415 `unsupported_transport`) is fetched. Streams (`openUserEvents`, `openSessionStream`) are calls on the socket that survive every interruption — a reconnect, a server-side end, a 503 while a machine reconnects — by being re-issued with their last event id; a 401/403/404 stops them. When the handshake keeps failing the page falls back to `EventSource` and fetch.
- The two SSE endpoints and the `/server/<id>/api/…` proxy are unchanged; the CLI keeps consuming SSE over HTTP.
