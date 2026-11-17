# 同一段对话复用提示缓存路由

- **日期：** 2026-11-18
- **类型：** feature
- **范围：** `core`、`server`、`cli`
- **PR:** [#1595](https://github.com/Prism-Shadow/penguin-harness/pull/1595)

[English](2026-11-18-mmsp-cache-sessions.md)

PenguinHarness 已升级至 MMSP 0.5.10。发送交互消息时，同一会话的后续对话、工具结果、重试和恢复请求携带相同的匿名标识。不同项目、Agent 和会话使用各自的标识。支持提示缓存路由的模型端点可以据此复用缓存。

会话记录和历史回放都保留模型给出的工具参数 JSON 原文，包括空格、大整数和长小数。
