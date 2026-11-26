# 通过模型列表检测 Google GenAI

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#1728](https://github.com/Prism-Shadow/penguin-harness/pull/1728)

[English](2026-11-23-google-genai-protocol-detection.md)

端点返回 Google 模型列表时，**检测协议**可以选中 Google GenAI。探测 Anthropic Messages 或检查 OpenAI 鉴权时，通用网关错误不会触发协议选择。
