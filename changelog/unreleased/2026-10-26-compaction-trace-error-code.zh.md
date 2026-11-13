# 保留 Trace 中的压缩请求错误码

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1358](https://github.com/Prism-Shadow/penguin-harness/pull/1358)

[English](2026-10-26-compaction-trace-error-code.md)

修复了压缩请求写入 Trace 的 `request_end` 记录时遗漏模型错误码的问题。失败尝试现在同时保留错误码和错误信息，后续重试成功也不会丢失先前尝试的错误分类。
