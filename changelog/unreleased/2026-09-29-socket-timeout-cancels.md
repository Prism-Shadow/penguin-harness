# A call the page gives up on is cancelled on the server, and its forward to a machine dropped

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `web`, `server`

[中文版](2026-09-29-socket-timeout-cancels.zh.md)

When a call over the API socket went unanswered for 20 s, the page gave up on it, but the server did not know that. The server kept working the call. For a call to a machine, that meant a forward held open on the very route that was not answering. With several reloads outstanding, those forwards piled up on the hub while the page had long stopped waiting for them. Now giving up on a call releases it on the server as well.

## Details

- At the answer timeout, the page sends a `cancel` frame for the call. The server aborts the call's request, as it already did for streams.
- The machine proxy drops its forward when the request it carries is aborted. A cancelled forward is not recorded as the machine being unreachable.
