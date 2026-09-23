# A stopped machine is started so the build can be handed to it

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#839](https://github.com/Prism-Shadow/penguin-harness/pull/839)

[中文版](2026-09-23-handover-starts-server.zh.md)

Enabling a machine whose program was current but whose server was down recorded the machine
as being on this build while nothing had reached it: the hand-over goes through the running
server's update channel, and with none there was nothing to hand the build to. From then on
"use" read its own record, said "already on", and did nothing — the machine kept running the
older build, and the forced install, which only a failed job offers, was out of reach.

## Details

- A hand-over that finds no server running now starts it, then hands the build to it the way
  it does to any running server, refusals included. A server that cannot be started fails
  the job, with the forced install offered.
- "Use" no longer trusts the install record: it always asks the machine what it carries (the
  installer's own probe, one ssh round trip), and says "already on" only when the machine does.
