# Abort banners localize by decoding the reason of record

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `web`, `cli`

[中文版](2026-08-25-abort-banners-localize-by-decoding-the-reason.zh.md)

The abort event stays the human-interrupt payload it always was — `type` plus the English `reason` of record, no extra fields — and the Web chat banner and the CLI abort line now localize it anyway: the engine writes `reason` from a fixed set of spellings (`aborted by user`, `llm request error: <detail>`, `llm request failed after <N> retries[: <detail>]`, `aborted during reconnect backoff`, `aborted during compaction`, `compaction failed`), and core's new `parseAbortReason` decodes that set — pre-convergence exhausted spellings included — into a renderable cause. A Chinese UI now reads `[已中断]：模型请求错误：401 Missing Authentication header` instead of gluing its localized prefix onto English engine prose; the provider detail is untranslatable and stays verbatim, and unrecognized prose renders as-is.

The structured record is unchanged: observability and the server's error records keep reading `reason`, and the concrete error behind an LLM failure also rides on `request_end.error_message` — the same text the decoder extracts as the detail suffix.
