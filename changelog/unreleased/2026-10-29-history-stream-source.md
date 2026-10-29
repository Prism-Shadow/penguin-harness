# Paced socket streams and a machine's history as Trace lines

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `docs`
- **PR:** [#1391](https://github.com/Prism-Shadow/penguin-harness/pull/1391)

[中文版](2026-10-29-history-stream-source.zh.md)

A stream call over the API socket could ask for acknowledged flow with `x-flow: credit`. The client acknowledged the event data it had handled, and the server kept no more unacknowledged data in flight than two seconds of the measured delivery, between 32 KiB and 1 MiB, so one large transfer no longer queued minutes of bytes ahead of the socket's other calls. A stream could also beat with a named `ping` while it waited, and a one-shot call released while its answer was still being read no longer received a stray `200` frame.

The socket between two servers, and the socket to a browser on another computer, compressed its frames with permessage-deflate. A browser on the same computer, the desktop app included, was answered without compression.

Every server answered `GET /api/sessions/:sessionId/history-lines` for its own Sessions: a history window's envelope and the layout of the Trace bytes its records come from, then only the Trace lines the caller did not hold, as whole lines, newest first, in frames of at most 32 KiB, with any longer line split into parts. Held ranges were checked by file identity, size and the hashes of their first and last bytes, and a file that failed the check was sent again from scratch. `GET /api/sessions/:sessionId/trace-body?ref=` returned one folded value whole.

Core's `interfaces` subpath gained the folding rule that history windows use: a tool output, a subagent's inline image, a long string inside a tool call's arguments or a thinking block over 16 KiB kept a short head and tail, and an `elided` entry named the value so that it could be fetched when unfolded.
