# Backward compatibility

- **Date:** 2026-09-07
- **Type:** process
- **Scope:** `server`, `web`

[中文版](2026-09-07-backward-compatibility.zh.md)

[The terminal survives a mobile network](2026-09-07-terminal-on-a-slow-link.md) adds two
opcodes to the terminal stream — `Ping` (0x07) and `Pong` (0x08) — and both ends of that
stream can be older than this release. Nothing on disk is affected: no schema, no config, no
stored Trace. What is affected is a socket that is open right now.

## Two peers that do not know the opcode

A hot push replaces the platform and the Web App **without reloading an open tab**. So the
common case, minutes after an update, is a page from before this release talking to a server
from after it. The reverse happens too: this Web App attaches to terminals on machines
(`<terminalId>@<machineId>@<userId>`), and those machines run whatever version they were last
installed with.

An unknown opcode is already harmless in both directions — each end ignores what it cannot
decode, which is what the wire format was designed for. The hazard is the *conclusion* each
end draws from silence:

- A server would find an old page never answering its probes, decide the socket was dead, and
  close it. That page has no reattach either, so the pane would go dead every 75 seconds.
- This page would find an old server never answering, and — an idle terminal produces no
  output for perfectly good reasons — reattach every minute or so, repainting the whole screen
  from a snapshot each time.

Chosen: **one rule, applied on both sides, with no version negotiation** — only a peer that
has *answered* a probe is ever judged for its silence. A peer that has never sent a `Pong`
cannot send one, and its quiet says nothing. Everything else about an old peer is unchanged:
attach, restore, resize, input and exit are the frames they always were.

Nobody has to do anything. An old page picks the new behaviour up on its next reload; an old
machine does when its server is updated.

## When this comes out

The rule costs one boolean per socket on each side (`answersProbes` in
`server/src/terminal/stream.ts` and `web/src/features/terminal/terminal-connection.ts`). It
can be dropped once no page or machine older than this release is expected to attach — in
practice, one release after this one ships, by whoever next touches the heartbeat. Until then
it is also what keeps a non-browser client (a test, a CLI attach) from being reaped for being
quiet, which is worth reading before deleting it.
