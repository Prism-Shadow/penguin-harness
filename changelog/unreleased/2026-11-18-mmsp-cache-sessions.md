# Keep a conversation on the same prompt-cache route

- **Date:** 2026-11-18
- **Type:** feature
- **Scope:** `core`, `server`, `cli`
- **PR:** [#1595](https://github.com/Prism-Shadow/penguin-harness/pull/1595)

[中文版](2026-11-18-mmsp-cache-sessions.zh.md)

PenguinHarness sends the existing Penguin Session ID to MMSP 0.5.10 on each interactive model request. Follow-up messages, tool results, retries and resumed conversations share it. New and forked Sessions use their own IDs. Requests outside a Session omit it. MMSP uses it on endpoints that support prompt-cache routing.

Tool calls now retain the model’s original JSON in the conversation and when replaying history, including whitespace, large integers and long decimals.
