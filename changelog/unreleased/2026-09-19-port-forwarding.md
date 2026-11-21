# Port forwarding: ssh's own -L and -R on a machine's session, both ways, saved per Workspace

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`

[中文版](2026-09-19-port-forwarding.zh.md)

A Workspace on a machine can bring that machine's ports to this server (`in`) or send this server's ports to the machine (`out`), from a Ports panel in the dock. A forward is ssh's own `-L` or `-R`, on the one session already held to the machine; it is saved, and it survives a restart and a hot push.

## Forwards

- **A forward is `(machine, Workspace, direction, remote port ⇄ local port)`.** It belongs to the Workspace — a directory on a machine — so every conversation there sees the same forwards. `in` puts the machine's port on `localhost:<local port>` here; `out` puts our port on `localhost:<remote port>` there. A Workspace on this server has none: its ports are on the loopback already.
- **Saved in `web.db`** (table `port_forwards`, migration `2026-10-11-port-forwards`, swap-safe; a root that took an earlier form of that table is brought forward by `2026-10-11-port-forwards-adoption` and `2026-10-11-port-forwards-direction` — see [backward compatibility](2026-09-22-backward-compatibility.md)). An `in` forward's local port defaults to the remote port's own number when it is free here, else the first free port above it; a specific one (1024–65535) can be asked for. An `out` forward names the local service it sends; the machine's port defaults to the same number.
- **The machine's session carries them.** A machine's forwards are its session's wanted set. The session masters a control socket (`ssh -M -S`), so a forward is added to the LIVE session with `ssh -O forward` and taken off with `-O cancel` — no second connection, no reconnect, and a port that will not bind fails that one ask, not the session. The set is re-applied whenever the session comes back up. A forward never opens ssh: on a machine nobody is using it waits, and says so.
- **On a Windows hub** — Win32 OpenSSH has no control socket — the session carries its forwards in its start arguments instead: a change of the set reopens the session with the new set (the channels through it reconnect on their own), and what ssh says of a forward it could not bind is read off its stderr. Both directions, the same records, the same status.
- **Status by layer, not a flag:** `not-connected` (the session is down), `pending` (up, ssh has not answered), `active` (ssh has it), `failed` with ssh's own words.
- **The held session's shape grows the two forward members** (`setForwards`, `forwardFacts`), so the first push after this build finds its predecessor's held sessions of another shape: their group is disposed on that push and every machine is re-held once, as the resource registry's shape check prescribes. Once, per machine, and never again until the shape changes.

## API

- `GET /api/port-forwards?machine=&workspace=`, `POST /api/port-forwards` (`direction` defaults to `in`), `DELETE /api/port-forwards/:id`, admin only.

## Pages

- **The dock has a Ports panel.** Every forward is drawn as a cable between two named plugs — the machine's alias and its port, `here` and the local port — with the arrow saying which way the bytes go: an `in` forward starts at the machine, an `out` one starts here. The cable's ink is the status (blue carried, grey waiting for ssh, amber machine not connected, red refused), and one line under it says so in words. The form is the same cable with the two ports still to be typed; the arrow between the plugs is a button, and clicking it swaps them — that is how a direction is chosen.
- **A machine's card has a Ports verb** that opens `/machines/<machineId>/ports`: every forward of that machine, grouped by Workspace, drawn the same way, for debugging a port that does not answer.
