# Count metered requests once after abnormal finishes

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1356](https://github.com/Prism-Shadow/penguin-harness/pull/1356)

[中文版](2026-10-26-metered-request-count.zh.md)

Fixed the Cost Center adding a second request when a model reported token usage and then ended with an abnormal finish reason. Subsequent attempts and concurrent child sessions remain separately counted. Title generation is billed independently, so a title finishing during a conversation request does not suppress that request's later failure.
