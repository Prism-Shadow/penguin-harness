# Every machine has an id of its own, and a status you can ask for

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`

[中文版](2026-09-01-machines-identity.zh.md)

A machine now says who it is and whether its server is up. The list opens with **this machine**, every installed one carries the last status probed for it, and `penguin server status` is the one command a controller runs over ssh to ask.

## Which machine is which

Every machine mints an id of its own — 16 base64url characters, by the server that runs there, this one included — and keeps it ever after. base64url because the id lands in paths, query strings and file names, where `+` and `/` do not survive; 96 bits because ids are minted on machines that never coordinate, so the bar is the birthday bound.

An ssh alias cannot do that job: an alias is a line in one machine's config file, so the same host is `build-box` here and `bb` there, and two aliases for one host are two names for one machine. Aliases stay what you READ; the id is the identity behind them, and it is what anything stored points at.

It rides the status probe's own round trip, so learning it costs nothing extra, and it is remembered beside the install record. A machine whose server has never started has no id yet — nothing has minted one — and says so rather than being given a made-up one. An alias repointed at a different host answers a different id, and the newer answer wins: an id never changes for a machine, so a change of id is a change of machine.

## This machine, and whether the others are up

The list opens with **this machine** — the host the server runs on, named by its hostname, with the version it runs and the port it serves on. It is read directly rather than probed (both facts are right here), it is always present, and it is never an install target: a server does not push this build over its own program directory while running from it, so `POST …/install` on it answers `409 self_install`.

Every installed machine then carries its server's state: running with the port, stopped, or unreachable with OpenSSH's own diagnostic behind it. There is deliberately no separate "ssh" status — ssh is the transport, so a machine it cannot reach reads as one thing rather than two a reader has to combine.

Status costs an ssh round trip per machine, so it is **never taken at list time** and never for the whole ssh config — only for the machines this Project actually installed on, five at a time, and only when `POST …/machines/probe` asks.

## `penguin server status`

```bash
penguin server status
# {"running":true,"port":7364,"pid":41233,"machineId":"LNrJdHAZJ91G58i0"}
```

Machine-facing on purpose. The question used to be asked in shell — `cat` the lock, `sed` the pid out, `kill -0`, `cat` a second file for the id — which meant a parser on this side for a format nobody defined, and no answer at all from a Windows remote, `kill -0` having no cmd.exe equivalent. Asking the machine's own CLI moves both problems to the side that has Node.

`running` requires the recorded pid to be alive **and** its port to accept, which the shell version could not do: it only had `kill -0`, and a recycled pid reads as a live server.

Reading the id never mints one, and a status probe opens the database read-only — a controller asking a machine what it is must not reshape that machine's schema under the server running there, nor leave a data root behind on a machine that never had one.

Output that holds no answer at all is reported as **unreachable**, not as stopped: a build too old for the subcommand prints an error, and reading that as a well-formed "no" would turn every such machine into a silently wrong one.
