# Retry session history after timeouts and rate limits

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `amsp`
- **PR:** [#1332](https://github.com/Prism-Shadow/penguin-harness/pull/1332)

[中文版](2026-10-26-amsp-history-retry.zh.md)

`SessionReader` retries history requests that return HTTP 408 or 429 while keeping the live stream open. Once the history request succeeds, history and buffered live records are delivered in order with duplicates removed. Permanent refusals such as 401, 403 and 404 still stop the reader, and closing the reader cancels a pending retry.
