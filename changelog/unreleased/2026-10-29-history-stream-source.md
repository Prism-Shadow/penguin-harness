# Paced socket streams and a machine's history as Trace lines

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`, `core`, `web`, `docs`
- **PR:** [#1391](https://github.com/Prism-Shadow/penguin-harness/pull/1391)

[中文版](2026-10-29-history-stream-source.zh.md)

A stream call over the API socket could ask for acknowledged flow with `x-flow: credit`. The server echoed the header in the stream's start frame; only then did the client acknowledge the event data it had handled, so a server older than acknowledgements never received one. The server kept no more unacknowledged data in flight than two seconds of the measured delivery, between 32 KiB and 1 MiB, so one large transfer no longer queued minutes of bytes ahead of the socket's other calls. A stream could also beat with a named `ping` while it waited, without using its window, and a one-shot call released while its answer was still being read no longer received a stray `200` frame. A peer's own ping counted as a sign of life, so a hub still receiving over a slow link was no longer dropped while the server's ping waited behind queued output.

The socket between two servers, and the socket to a browser on another computer, compressed its frames with permessage-deflate, each frame on its own (no context takeover), so no frame's size depended on another frame's content. A browser on the same computer, the desktop app included, was answered without compression.

Every server answered `GET /api/sessions/:sessionId/history-lines` for its own Sessions. The stream began and beat before anything was read. It sent a history window's envelope and the layout of the Trace bytes its records come from, then only the Trace lines the caller did not hold: whole lines, newest first, with no event over 32 KiB of text, the window included. The rest of a line the caller held in part went before the window was ready only when the window needed that line; any other came after it, so a window reopened after a cut inside a large screenshot did not wait for the screenshot. Every range the caller held was checked by file identity, size, line edges and the hashes of its first and last bytes, and a file that failed the check was sent again from scratch. Identity was the inode: a device number that changed across a container restart, or a birth time the platform did not keep, no longer reset a file. A running Task's held inputs were offered only when the window did not already hold them, so its image was not shown twice. Inode numbers travelled as decimal strings, so NTFS file ids above 2^53 stayed exact.

Every windowed history page said how many Tasks it held (`page.units`), counted where the window was cut and by the same rule, so a client paging until it had N Tasks counted what `tailLimit` and `limit` count.

An admin without access to a Session, the identity a hub reads its machines as, was refused every Session route with 403 `session_forbidden` rather than told the Session did not exist; anyone else without access still got 404, and the Web App said the Session was not accessible.

`GET /api/sessions/:sessionId/trace-body?ref=` returned one folded value whole, and only for a ref into the Session's own lines or those of a subagent Session it had spawned; any other ref, including one naming another Project's files, answered 404.

Core's `interfaces` subpath gained the folding rule that history windows use: a tool output, a subagent's inline image, a long string inside a tool call's arguments or a thinking block over 16 KiB kept a short head and tail, and an `elided` entry named the value so that it could be fetched when unfolded.
