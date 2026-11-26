# OpenCode Go 使用各模型的原生端点

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `core`, `server`, `docs`
- **PR:** [#1733](https://github.com/Prism-Shadow/penguin-harness/pull/1733)

[English](2026-11-23-opencode-go-inference.md)

新的 OpenCode Go 预设使用 Go 网关公布的模型 ID 和原生协议。Gemini 4 Argon 使用 Google Interactions，支持流式工具调用。Chat Completions、Responses 与 Messages 预设使用对应的 Go 推理端点。
