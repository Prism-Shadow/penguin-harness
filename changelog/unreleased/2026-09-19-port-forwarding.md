# Port forwarding: a machine's port on this server's loopback, per Workspace

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#804](https://github.com/Prism-Shadow/penguin-harness/pull/804)

[中文版](2026-09-19-port-forwarding.zh.md)

A Workspace on a machine can forward that machine's TCP ports to this server's loopback, from a Ports panel in the dock. Forwards are saved, and a machine's Ports page lists every one of them with what is known of each.

## Forwards

- **A forward is `(machine, Workspace, remote port) → local port`.** It belongs to the Workspace — a directory on a machine — so every conversation there sees the same forwards. A Workspace on this server has none: its ports are on the loopback already.
- **Saved in `web.db`** (table `port_forwards`, migration 13 `port-forwards`, swap-safe). A forward comes back after a restart or a hot push on the same local port. The default local port is the remote port's own number when it is free, else the first free port above it; a specific one (1024–65535) can be asked for.
- **The listener binds `127.0.0.1` only.** It binds when the forward is made and whenever the platform starts. A port that will not bind at start is reported on the forward; the record and its port are left as they are.
- **A dial happens only when a client connects**, through the one connection held to the machine (`Machines.dialPort`). A forward never opens ssh: with the machine not connected, the client is closed at once and the reason is kept.
- **Half-closed connections are carried through**, so a client that finishes sending still receives its answer.

## API

- `GET /api/port-forwards?machine=&workspace=`, `POST /api/port-forwards`, `DELETE /api/port-forwards/:id`, admin only.
- Each forward reports its facts by layer: `listener` (`{listening}` or `{error}`), `dial` (the last dial: `{answeredAt}` or `{failedAt, detail}`), `open` connections, `bytesUp` and `bytesDown`.

## Pages

- **The dock has a Ports panel.** Each row shows `remote port → localhost:<local port>` with a dot for its state: blue when the listener is up and the last dial answered (or none was made yet), amber when the last dial failed, red when the listener is down. A row can copy its local address, open it in the browser, or remove the forward. The form below takes a remote port and an optional local port.
- **A machine's card has a Ports verb** that opens `/machines/<machineId>/ports`: every forward of that machine, grouped by Workspace, with the listener state, the last dial and when, the open connections and the bytes each way. Forwards can be removed there, and are added from a conversation's Ports panel.
