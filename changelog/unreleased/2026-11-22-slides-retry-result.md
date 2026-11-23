# Keep the previous task result out of a Slides retry

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `use-bento-slides`
- **PR:** [#1707](https://github.com/Prism-Shadow/penguin-harness/pull/1707)
- **Issue:** [#1701](https://github.com/Prism-Shadow/penguin-harness/issues/1701)

[中文版](2026-11-22-slides-retry-result.zh.md)

Slides waits for a new request to reach its Session before collecting results. Refreshing the panel while a retry is starting keeps the previous interruption attached to its original message.
