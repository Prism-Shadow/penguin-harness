# Keep history retries on schedule while following a session

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1333](https://github.com/Prism-Shadow/penguin-harness/pull/1333)

[中文版](2026-10-26-amsp-history-backoff.zh.md)

After a transient history failure, `SessionReader` waits for the retry delay even if new records or heartbeats arrive. Closing the reader cancels pending history retries as well as stream reconnection. Starting over from history cancels the previous history retry so it cannot trigger an early request on the new connection.
