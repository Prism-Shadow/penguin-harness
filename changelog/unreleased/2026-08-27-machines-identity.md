# Install this build on another machine over ssh, and hold a connection to it

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#448](https://github.com/Prism-Shadow/penguin-harness/pull/448)

[中文版](2026-08-27-machines-identity.zh.md)

A machine is a host in this server's own `~/.ssh/config`. The Machines page lists them, installs this build on one, and holds a connection to it — after which that machine's API answers at `/server/<machineId>/api/…` on this origin. Everything a machine is asked, it is asked over ssh; nothing new listens anywhere.

## Identity

A machine mints an id of its own when its server first starts — 16 base64url characters, stable across renames, re-aliasing and reinstalls. That id is what anything stored points at, because an alias is a line in one config file and a person may rewrite it. The address (`ssh:<alias>`) is how this server reaches it, and the alias is what a person reads; two aliases for one host share one id.

## Installing, and putting a build into service

An install downloads the release on the far side rather than shipping it from here, with the installer itself riding stdin — one handshake instead of three. What was installed is then read back **from the machine**, since an install that ran cleanly and changed nothing would otherwise be recorded as a success at a version the machine does not have.

A machine that already carries the right release but different pushed state is a hot update, not an install: it goes over that machine's own update channel, which asks the machine and reports its answer, refusals included. The hand-over carries the platform, CLI and web bundles **and the native assets** — a platform resolves `node-pty` out of its assets directory and nowhere else, so a hand-over without them leaves every terminal on that machine unable to start. Exec bits travel with the files, and `spawn-helper` by name as well as by mode, because Windows has no exec bit to read.

## One mouth per machine

Every word this server speaks to a machine leaves through that machine's `MachineConnection` (`machines/transport/`): small commands over one held `ssh -T sh` shell, long steps and stdin payloads over their own ssh, bulk transfers streamed, and the `ssh -N -L` forward that makes its server a loopback origin here. The modules behind that door are private and a test pins it — nothing outside opens ssh. The guarantee is authority rather than socket count: what sockets exist underneath is the directory's own business, and can tighten later without a caller noticing.

## Facts that name the layer they measured

Three different things can be true of a machine, so the list says which one it is reporting:

- `forward` — this server holds an `ssh -N -L` to it. A fact about an ssh child on **this** side, which outlives the far server.
- `status` — a server is (or is not) up over there, as of the last probe, with the probe's own timestamp. Probing costs an ssh round trip, so the list reports the last answer and never probes itself.
- `api` — the machine's API answered, or did not, when this server's proxy last carried a request to it. Stamped by that traffic rather than by a probe of its own: no timer, no loop, and a machine nobody asks about is simply not measured.

Reading one of these for another is how a live forward to a dead server reads as a healthy machine, so connect asks what is actually running there even when a forward is already held, and starts the server when nothing is.

## Reach

Admin-only, end to end: the page, the proxy, and every route behind them. One identity throughout — the caller is this server's admin, and this server's admin is that machine's admin, over a session this server mints through the ssh access that installed the program. The browser's cookies never travel and the machine's never come back.
