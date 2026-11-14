# Stop delivering buffered stream events after cancellation

- **Date:** 2026-10-25
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1326](https://github.com/Prism-Shadow/penguin-harness/pull/1326)

[中文版](2026-10-25-amsp-abort-buffered-events.zh.md)

When a caller aborts an AMSP stream between events, the next read rejects with the cancellation reason. Events already buffered in the same network chunk are no longer delivered after cancellation, and a buffered `[DONE]` no longer reports a cancelled request as successfully completed.
