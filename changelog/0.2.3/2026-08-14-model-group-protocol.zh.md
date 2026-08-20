# 模型：移入 Custom 分组时改用 OpenAI 兼容客户端

- **Date:** 2026-08-14
- **Type:** fix
- **Scope:** `web`, `model-catalog`
- **PR:** [#282](https://github.com/Prism-Shadow/penguin-harness/pull/282)

[English](2026-08-14-model-group-protocol.md)

将已有模型移入 Custom 分组时，现在会把 `client_type` 设为 `openai`，与直接添加到该分组的模型保持一致，避免自定义 ID 触发不支持的模型错误。

第一方分组中的未知 ID 现在提供一键移入 Custom 的入口，并保留已填写的设置。
