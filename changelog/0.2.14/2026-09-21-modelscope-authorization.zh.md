# ModelScope 授权与令牌续期

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `docs`, `core`
- **PR:** [#814](https://github.com/Prism-Shadow/penguin-harness/pull/814)

[English](2026-09-21-modelscope-authorization.md)

新增 ModelScope 授权聚合模型组、三条预置模型、按模型区分的 AgentHub 协议，以及由服务端管理的令牌续期。

## 模型与授权

- 在 ModelScope API-Inference 端点新增通过 `deepseek-v4` 请求的 `deepseek-ai/DeepSeek-V4.1-Flash`，以及通过 `openai-chat-vllm-adapter` 请求的 `Qwen/Qwen3.8-27B` 和 `Qwen/Qwen3.8-Flash-Next`。
- 新增纯色 ModelScope 标识与授权弹窗；浏览器通过 ModelScope bridge 完成授权，交付的凭据不会暴露给 Web App。

## 令牌续期

- refresh token 与 access token 到期时间保存在服务端，当前 access token 继续使用 Project 中既有的 `api_key` 字段。
- 在 ModelScope 请求前刷新即将过期的凭据，串行处理刷新与模型配置写入，并在连续刷新失败后提示用户重新授权。
- 数据库与回滚行为记录在 [ModelScope refresh token 向后兼容](2026-09-21-backward-compatibility.zh.md)中。

## 既有 Project

新建 Project 会带有三条 ModelScope 预置模型。既有 Project 只有在用户于模型页面执行**同步预置**后才会获得这些模型；同步会追加模型并更新目录管理的字段，不会删除模型或修改已保存的默认模型。
