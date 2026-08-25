# 中断横幅按机器可读原因本地化

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `web`, `cli`

[English](2026-08-25-abort-banners-localize-from-a-machine-readable-cause.md)

abort 事件在英文 `reason` 记录之外新增机器可读的 `code`(`user_abort` / `llm_fatal` / `llm_retries_exhausted` / `backoff_interrupted` / `compaction_aborted` / `compaction_failed`),并携带 `detail`(`LLMOutcome.errorMessage` 原文)与 `attempts`(重试耗尽时的次数)。Web 对话横幅与 CLI 中断行按 code 出本地化文案——中文界面现在显示 `[已中断]:模型请求错误:401 Missing Authentication header`,不再把本地化前缀拼在英文引擎文案上——`detail` 原样缀后,因为 provider 的报错文本本就不可翻译。

`reason` 保持英文记录:观测与服务端异常记录照旧读它;该字段出现之前写下的 Trace 在任何语言下都按 `reason` 原样展示。
