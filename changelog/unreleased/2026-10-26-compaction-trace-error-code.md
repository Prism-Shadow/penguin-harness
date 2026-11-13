# Preserve compaction request error codes in Trace

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1358](https://github.com/Prism-Shadow/penguin-harness/pull/1358)

[中文版](2026-10-26-compaction-trace-error-code.zh.md)

Fixed compaction requests omitting the model's error code from their Trace `request_end` records. Failed attempts now retain both their code and message, including when a later retry succeeds.
