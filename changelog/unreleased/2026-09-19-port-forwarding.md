# Port forwarding: ssh's own -L and -R on a machine's session, both ways, saved per Workspace

- **Date:** 2026-09-19
- **Type:** feat
- **Scope:** `server`, `web`, `docs`
- **PR:** [#804](https://github.com/Prism-Shadow/penguin-harness/pull/804)

[中文版](2026-09-19-port-forwarding.zh.md)

A Workspace on a machine can bring that machine's ports to this server (`in`) or send this server's ports to the machine (`out`), from a Ports panel in the dock. A forward is ssh's own `-L` or `-R`, on the one session already held to the machine; it is saved, and it survives a restart and a hot push.

## Forwards

- **A forward is `(machine, Workspace, direction, remote port ⇄ local port)`.** It belongs to the Workspace — a directory on a machine — so every conversation there sees the same forwards. `in` puts the machine's port on `localhost:<local port>` here; `out` puts our port on `localhost:<remote port>` there. A Workspace on this server has none: its ports are on the loopback already.
- **Saved in `web.db`** (table `port_forwards`, migration 15 `port-forwards`, swap-safe; a root that took an earlier form of that table is brought forward by migration 17 — see [backward compatibility](2026-09-22-backward-compatibility.md)). An `in` forward's local port defaults to the remote port's own number when it is free here, else the first free port above it; a specific one (1024–65535) can be asked for. An `out` forward names the local service it sends; the machine's port defaults to the same number.
- **The machine's session carries them.** A machine's forwards are its session's wanted set. The session masters a control socket (`ssh -M -S`), so a forward is added to the LIVE session with `ssh -O forward` and taken off with `-O cancel` — no second connection, no reconnect, and a port that will not bind fails that one ask, not the session. The set is re-applied whenever the session comes back up. A forward never opens ssh: on a machine nobody is using it waits, and says so.
- **On a Windows hub** — Win32 OpenSSH has no control socket — the session carries its forwards in its start arguments instead: a change of the set reopens the session with the new set (the channels through it reconnect on their own), and what ssh says of a forward it could not bind is read off its stderr. Both directions, the same records, the same status.
- **Status by layer, not a flag:** `not-connected` (the session is down), `pending` (up, ssh has not answered), `active` (ssh has it), `failed` with ssh's own words.
- **A forward ssh refused is asked again**, after 2 s, 5 s and 15 s, then left as ssh said. A refusal is usually the session's own doing: a reopened session asks for the ports the session it replaced still holds — the far sshd releases a listener only once it sees that connection end — and so does the session a new build opens across a hot push while the old one is being closed. The reopen itself now waits for the old child to be gone before spawning the next; the retries cover what the far side has not released yet. A port something else owns stays `failed` until the wanted set changes or the session reconnects.

## Held sessions survive a hot push

The `ssh -T -D` session held to a machine used to be closed by the generation that opened it and reopened by the next — so every forward, every Browser dial and every terminal relay through it broke on every push. A held session is now delivered through the resource registry (`machineSession:<address>`), the way a pty is: the next generation claims the same ssh child by address and hands it the same wanted set. Transient sessions are still closed with their generation. The registry group is versioned in its name (`machineSession.v2`): a delivered object runs the code of the generation that made it, so a change in how sessions behave bumps the name, the old group is disposed on the push and every machine is re-held once with objects of the new code. The name guards behavior; structure has its own guard: the leaving generation registers the closed shape of the session interface (`MachineSession` — every method, and every type behind them, printed from the interface table) beside the sessions, and the booting one compares it with its own before claiming anything. A different shape dooms the group: its sessions are closed at the commit instead of running under a transport that calls them differently, and every machine is re-held.

## API

- `GET /api/port-forwards?machine=&workspace=`, `POST /api/port-forwards` (`direction` defaults to `in`), `DELETE /api/port-forwards/:id`, admin only.

## Pages

- **The dock has a Ports panel.** Every forward is drawn as a cable between two named plugs — the machine's alias and its port, `here` and the local port — with the arrow saying which way the bytes go: an `in` forward starts at the machine, an `out` one starts here. The cable's ink is the status (blue carried, grey waiting for ssh, amber machine not connected, red refused), and one line under it says so in words. The form is the same cable with the two ports still to be typed; the arrow between the plugs is a button, and clicking it swaps them — that is how a direction is chosen.
- **A machine's card has a Ports verb** that opens `/machines/<machineId>/ports`: every forward of that machine, grouped by Workspace, drawn the same way, for debugging a port that does not answer.
