# ModelScope 预置改用 Responses 协议

- **Date:** 2026-09-22
- **Type:** fix
- **Scope:** `model-catalog`, `web`, `docs`
- **PR:** [#820](https://github.com/Prism-Shadow/penguin-harness/pull/820)

[English](2026-09-22-modelscope-responses-protocol.md)

将三条内置 ModelScope 预置统一切换到 AgentHub 通用 OpenAI Responses 客户端。

## 细节

- 将 `deepseek-ai/DeepSeek-V4.1-Flash`、`Qwen/Qwen3.8-27B` 和 `Qwen/Qwen3.8-Flash-Next` 固定为 `client_type = "openai-responses"`，推理请求发往既有 api-inference base URL 的 `/responses` 路径。
- 既有 Project 会保留已存协议，直到执行**同步预置**或下一次 ModelScope 授权，由目录更新其客户端类型。本次没有新增 Project 配置字段或数据库迁移。
