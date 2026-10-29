# Paced socket streams and a machine's history as Trace lines

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `docs`
- **PR:** [#1391](https://github.com/Prism-Shadow/penguin-harness/pull/1391)

[中文版](2026-10-29-history-stream-source.zh.md)

A stream call over the API socket could ask for acknowledged flow with `x-flow: credit`. The server echoed the header in the stream's start frame; only then did the client acknowledge the event data it had handled, so a server older than acknowledgements never received one. The server kept no more unacknowledged data in flight than two seconds of the measured delivery, between 32 KiB and 1 MiB, so one large transfer no longer queued minutes of bytes ahead of the socket's other calls. A stream could also beat with a named `ping` while it waited, without using its window, and a one-shot call released while its answer was still being read no longer received a stray `200` frame.

The socket between two servers, and the socket to a browser on another computer, compressed its frames with permessage-deflate, each frame on its own (no context takeover), so no frame's size depended on another frame's content. A browser on the same computer, the desktop app included, was answered without compression.

Every server answered `GET /api/sessions/:sessionId/history-lines` for its own Sessions. The stream began and beat before anything was read. It sent a history window's envelope and the layout of the Trace bytes its records come from, then the rest of any line the caller held in part, then only the Trace lines the caller did not hold: whole lines, newest first, with no event over 32 KiB of text, the window included. Every range the caller held was checked by file identity, size, line edges and the hashes of its first and last bytes, and a file that failed the check was sent again from scratch. Inode numbers travelled as decimal strings, so NTFS file ids above 2^53 stayed exact.

`GET /api/sessions/:sessionId/trace-body?ref=` returned one folded value whole, and only for a ref into the Session's own lines or those of a subagent Session it had spawned; any other ref, including one naming another Project's files, answered 404.

Core's `interfaces` subpath gained the folding rule that history windows use: a tool output, a subagent's inline image, a long string inside a tool call's arguments or a thinking block over 16 KiB kept a short head and tail, and an `elided` entry named the value so that it could be fetched when unfolded.
