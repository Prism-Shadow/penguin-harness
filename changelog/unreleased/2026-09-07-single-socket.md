# One API socket per Web App tab, with shared machine event streams and bounded retries

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#912](https://github.com/Prism-Shadow/penguin-harness/pull/912)

[中文版](2026-09-07-single-socket.zh.md)

A Web App tab carries API calls and long-lived subscriptions over one WebSocket instead of letting separate HTTP streams exhaust the browser's connection slots. The server shares a socket and an event subscription per machine within its socket hub, detects silent calls and streams, and retries without multiplying unanswered requests. The existing HTTP user-event relay remains independent and may hold a second upstream subscription, including for machines without an API socket; the one-subscription guarantee does not span both transports. Design: PRFC-0011.

## API transport and compatibility

- The socket is a second transport of the existing API, not a new set of endpoints. Calls enter the same routes as HTTP, preserving authorization, validation and error bodies. Frames carry the method, path, JSON body and allowed request headers (`last-event-id`, `accept`, `content-type`); answers retain `date`, `content-type`, `retry-after` and `etag`.
- The handshake uses `GET /api/terminals/api-socket@<userId>/stream`, the signed-in user's reserved terminal-stream id. Session-cookie authentication, same-origin checks and ownership checks apply; the platform enters routes as that user through `Http.fetchAs`. The transport lives in the platform and uses the existing shell seam.
- SSE responses become a `stream` frame, event frames and an `end` frame. Cancellation aborts the endpoint request and releases its subscription. Socket heartbeats detect a peer silent for two beats; a reader beyond the send watermark ends with `lagging` rather than accumulating an unbounded queue.
- `apiFetch` uses the socket when available and HTTP otherwise. HTTP-only or declined endpoints answer `421 not_on_socket`; unsupported response bodies answer `415 unsupported_transport`, and the client fetches those responses over HTTP. Authentication and hot-update requests stay on HTTP.
- The existing SSE endpoints and `/server/<id>/api/…` proxy remain available, and the CLI continues consuming SSE over HTTP. A browser whose socket handshake keeps failing falls back to `EventSource` and fetch. The additive aggregate endpoint requires no data or configuration migration; older pages can keep their per-machine streams.
- Calls always enter the current App, including after plugin reassembly. On a platform push, the successor closes inherited sockets two seconds after boot with code `1012` and reason `the harness was updated; reconnect`; the browser reconnects and resumes its streams. Windows open during the first push carrying this handover still need one reload.

## Shared machine events

- The machine proxy and event hub share one socket cache per generation, dialled through each machine's SSH session as its admin. Sockets are reused only within that session; a replaced session drops the old socket and the next request dials again.
- Forwarded machine streams never fall back to HTTP. A refused handshake is remembered for one minute; a dial has a 10-second deadline, and a stream not opened within 8 seconds tears down its socket. Failures answer `502`/`504` with `machine_socket_refused`, `machine_socket_unavailable` or `machine_stream_not_opened` instead of holding another HTTP forward.
- Within the socket hub, aggregate and proxy readers share one upstream `/api/events` subscription per machine and a bounded replay buffer. A proxied reader receives the machine's own events and event ids; the independent HTTP user-event relay is retained rather than silently switched to socket-only delivery.
- `GET /api/projects/:projectId/machines/events`, available to admins and project members, opens immediately and carries every watched machine on one stream per tab. `machine_event` frames identify their source machine; `server_event` frames carry `hello` or `resync_required`, and an id-less heartbeat reports the aggregate's own liveness. Reconnects replay from a buffer that outlives the response, bounded to 10,000 events or 8 MB and filtered to the watched machines.
- Every 20-second aggregate heartbeat re-reads the Project's machines and attaches newly connected machines without reopening the tab's stream. Already attached machines are not looked up again on every beat; the hub owns their subsequent redials. The aggregate adapter lives in `machines/aggregate-stream.ts`.
- An aggregate holder keeps a machine subscribed after a failed dial or unopened stream. Retries start at 1 second and double to at most 30 seconds, re-reading the connection before each attempt so replacement SSH sessions are followed. A successful dial resumes from the machine's last event id. Repeated identical socket failures are logged and recorded once per failure run, not once per dial.
- A reader of `/server/<machineId>/api/events` receives a failed attempt immediately and retries on its own; the aggregate remains open while the hub retries its machine. Redialling stops when no reader holds the machine.
- The Machines page exposes `MachineInfo.socket`: `dialling`, `connected`, `refused` or `failed`, with the time the state began and failure details. It is null for the local host and before any stream requests a socket. This describes the local socket, not proof that the remote endpoint is answering.

## Silence, cancellation and retry limits

- Connection, call and stream liveness are tracked separately. User-event streams emit heartbeat events every 20 seconds; the hub cancels an upstream silent for two beats and resumes from its last event id, while the browser independently reissues its own silent stream. Replay misses request a resync, and a reader that stops consuming is ended at a 4 MB high-water mark instead of buffered without bound.
- A browser handshake still unopened after 10 seconds is closed and retried. Three failed handshakes against a reachable server give up on the socket for `EventSource` and fetch.
- A one-shot call unanswered after 20 seconds sends a `cancel` frame so the server aborts the request and the machine proxy drops its forward. Cancellation is not recorded as the machine being unreachable. A warning identifies the call and socket state; writes fail as network errors rather than being retried, because they may already have landed.
- An unanswered machine read over a socket that still carries frames fails with `machine_no_answer`, without duplicating the same forward over HTTP. Reads to this server, or reads after the socket itself goes quiet, retain their HTTP fallback.
- A machine that answers none of a Session-list reload's questions contributes cached rows while resting. After 2 seconds one question probes it; failed probes double the rest up to 30 seconds, and the first answer restores the full round. A local reload with no answers also retries from 2 to 30 seconds, with diagnostic warnings.
- A stream not opened within 20 seconds is cancelled and reissued. Interrupted streams resume with their last event id, backing off independently from 1 to 30 seconds; `401`/`403`/`404` stop retries. A conversation still loading history after 15 seconds reports its target and socket state.
- Error frames share one local writer, cancellation frames and retry cleanup have single client-side entry points, and hub reader cleanup is centralized without merging transport state machines. The relay detaches exactly once even when a subscription ends synchronously before returning its detach callback. Cancellation tests tolerate an already-sent SSE ping and close their socket even when an assertion fails.
