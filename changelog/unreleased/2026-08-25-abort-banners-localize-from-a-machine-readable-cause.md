# Abort banners localize from a machine-readable cause

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `web`, `cli`

[中文版](2026-08-25-abort-banners-localize-from-a-machine-readable-cause.zh.md)

The abort event now carries a machine-readable `code` (`user_abort` / `llm_fatal` / `llm_retries_exhausted` / `backoff_interrupted` / `compaction_aborted` / `compaction_failed`) alongside the English `reason` prose, plus `detail` (the raw `LLMOutcome.errorMessage`) and `attempts` (the retry count behind an exhausted ladder). The Web chat banner and the CLI abort line localize the cause from the code — a Chinese UI now reads `[已中断]：模型请求错误：401 Missing Authentication header` instead of gluing its localized prefix onto English engine prose — and append `detail` verbatim, since provider error text is not translatable.

`reason` stays the English record: observability and the server's error records keep reading it, and a Trace written before the field existed renders its `reason` as-is in every language.
