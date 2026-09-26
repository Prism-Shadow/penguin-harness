# One event stream per machine, and a stream that goes silent is detected

- **Date:** 2026-09-26
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-09-26-machines-one-event-stream.zh.md)

The hub holds one connection per machine and one stream per reader, whatever the machine
count. A browser tab used to open a machine's `GET /api/events` as its own stream, so the
hub carried (tabs × machines) upstream streams and one stuck machine multiplied its re-issue
storm by the number of tabs. The hub now subscribes to each machine's events **once**, over
the API socket it already holds to that machine, keeps a bounded replay buffer of its own,
and serves every reader out of it. A tab takes one stream that carries every connected
machine's events, each tagged with the machine it came from; a single machine's stream is
served from the same one subscription, so its events and `last-event-id` semantics are
unchanged from a reader's point of view.

## Details

- `GET /api/projects/:projectId/machines/events` is the aggregate: one response per tab,
  admin and project member, open at once and filled as each watched machine's socket
  resolves, so a machine that is slow to attach cannot hold a tab's stream up. Its frames are
  `event: machine_event` with data `{"machineId","event"}` — one of that machine's own server
  events — plus the hub's `server_event` frames (`hello`, `resync_required`) and a
  `heartbeat`. A `Last-Event-ID` is answered from the hub's own bounded buffer (10 000
  events / 8 MB), filtered to the machines that tab watches, so a reconnect is served by a
  buffer that outlives the stream it was written on.
- The socket this server holds to a machine was extracted into `machines/machine-sockets.ts`,
  shared by the stream relay and the hub: one dial per machine, with a 10 s dial deadline
  (over the transport's own), a refusal answered as `machine_socket_refused` while it lasts a
  minute, and `machine_socket_unavailable` where the socket is not to be had. A stream the
  machine does not open within 8 s tears that socket down (every stream on it ends and is
  re-issued, so the next dial reaches the machine's current App) and is answered
  `machine_stream_not_opened`.
- **Liveness on an open stream.** This server's `/api/events` and every machine's now write a
  `heartbeat` server event every 20 s (`http/sse.ts`, `HEARTBEAT_MS`) beside the `: ping`
  comment — a comment is invisible to everything that reads events rather than bytes. The hub
  ends an upstream stream that has missed two beats, cancels it and subscribes again with that
  machine's last event id; its readers keep their own stream and simply miss nothing. A tab
  times its own stream the same way: the API socket client ends a stream silent for two
  beats and re-issues it with its `last-event-id`, which is what the existing re-issue already
  does. A reader that stops consuming the aggregate is ended rather than buffered for without
  bound — the socket's own `lagging` rule one level down, on a 4 MB high-water per reader.
- **The Machines page** shows the socket this server holds to each machine: `connected`,
  `dialling`, `refused` or `failed`, with the instant that state was entered, so a stuck
  stream does not have to be found in the browser console. `MachineInfo.socket` carries it
  (`MachineSocketFact`), null for the local host and until a stream has asked for a socket at
  all — a fact about a process on this side, which says the socket exists and what it is
  doing, never that the far side is answering.
- The aggregate endpoint is additive, and a machine's own stream is untouched on the wire, so
  a page running the previous build against a server running this one keeps the per-machine
  streams it knows. No data or configuration is migrated.
