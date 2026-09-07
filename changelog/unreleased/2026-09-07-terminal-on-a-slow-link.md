# The terminal survives a mobile network

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-07-terminal-on-a-slow-link.zh.md)

A terminal opened over a phone's network used to die quietly. The socket does not close politely there — the radio hands over, a carrier NAT reaps an idle flow, the browser freezes the tab — and what the page was left holding was a connection that would never carry another byte, painted as "stream closed". The pty on the server was fine the whole time; a reload was the only way back to it.

Both ends now probe each other. Either side may send a Ping and the peer echoes it back untouched, so a socket that stopped carrying bytes is found within a heartbeat rather than never. The server closes a viewer that stops answering; the client reattaches after one that stops answering it, with a bounded backoff, and the reattach repaints the screen from the server's own snapshot — the same repaint a fresh attach gets. A network coming back, or a tab coming back, collapses that wait: the connection retries at once, and a socket that merely *looks* open is probed before it is trusted. A tab that was suspended is not mistaken for a dead link. The one failure worth stopping on is a terminal that is genuinely gone, which a retry checks for before it reconnects. The status word for all of this is `reconnecting`, distinct from the `connecting` of a first attach.

Three numbers stopped being constants tuned on a LAN:

- **The output merge window** followed the round trip. At 200ms it merged almost nothing while producing hundreds of small frames a second; it is now a quarter of the measured trip, bounded to 5–50ms, so a fast link keeps the behaviour it had.
- **The backpressure high-water mark** was a flat megabyte, which is milliseconds of lag on a LAN and many seconds on a slow uplink — the "output arrives late, then jumps" complaint. It is now derived from what the viewer's socket actually delivers, so it bounds *time* (three quarters of a second) instead of bytes.
- **Container resizes** reached the pty one per pixel change. On a phone the address bar collapses and the soft keyboard opens constantly, and every size that lands costs a SIGWINCH and a full repaint from whatever is running. They settle for 120ms now, and only a change that moves the grid is sent at all.

The stream is also compressed on the wire (permessage-deflate, bounded window, small frames left alone), which is worth a little CPU on the most compressible traffic this server has.

Both ends of the stream can be older than this release; what that costs, and the one rule that pays for it, is in [Backward compatibility](2026-09-07-backward-compatibility.md).
