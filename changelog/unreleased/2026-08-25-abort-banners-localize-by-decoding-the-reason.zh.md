# 中断横幅按 reason 记录解码本地化

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `web`, `cli`

[English](2026-08-25-abort-banners-localize-by-decoding-the-reason.md)

abort 事件保持人打断语义的原有载荷——`type` 加英文 `reason` 记录,不增任何字段——Web 对话横幅与 CLI 中断行照样实现了本地化:引擎写入的 reason 是固定拼写集合(`aborted by user`、`llm request error: <detail>`、`llm request failed after <N> retries[: <detail>]`、`aborted during reconnect backoff`、`aborted during compaction`、`compaction failed`),core 新增 `parseAbortReason` 解码该集合(含收敛前的旧耗尽拼写)得到可渲染的原因。中文界面现在显示 `[已中断]:模型请求错误:401 Missing Authentication header`,不再把本地化前缀拼在英文引擎文案上;provider 的报错文本不可翻译、原样保留,未识别的拼写按原样展示。

结构化记录不变:观测与服务端异常记录照旧读 `reason`,LLM 失败背后的具体错误同时由 `request_end.error_message` 承载——与解码器提取的 detail 后缀同文。
