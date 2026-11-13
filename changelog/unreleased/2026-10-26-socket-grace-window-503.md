# Grace-window calls on a replaced shell's socket answer 503 unavailable

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-26-socket-grace-window-503.zh.md)

After a hot push, the previous shell keeps serving its open API sockets for a short grace window (`RECONNECT_GRACE_MS`) before closing them with 1012 so the client can reconnect. A call made on those sockets inside the window failed with 500 `internal`: the push had already disposed the old App, whose module table no longer holds the HTTP entry, and the shell's lookup of that entry threw where its "being replaced" branch expected `undefined`. The shell now reads the throwing lookup as that same branch, so one-shot and streaming calls in the window answer 503 `unavailable` — "The App is being replaced." — which the web client already treats as retryable: a stream re-issues on its own backoff carrying its `last-event-id` and resumes on the new shell after the 1012 reconnect, and a one-shot call surfaces the same short-lived refusal instead of an unexplained internal error.
