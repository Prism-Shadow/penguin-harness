# OpenRouter 与 TokenDance 的应用归因，以及新增 TokenDance 分组

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `model-catalog`, `web`, `docs`

[English](2026-08-25-tokendance-and-app-attribution.md)

模型请求开始向读取应用归因请求头的网关声明 PenguinHarness，内置目录新增 TokenDance 分组及其六个预设。模型库的 Provider 分组顺序同时做了调整。

## 应用归因

模型目录新增 `attributionHeaders`，并接入每一个 `GenerativeModel`——由它作为 `defaultHeaders` 传给 AgentHub（`@prismshadow/agenthub` 0.4.7 起提供的构造参数）：

| 端点 | 请求头 |
| --- | --- |
| `openrouter.ai` | `HTTP-Referer: https://penguin.ooo/`、`X-OpenRouter-Title: PenguinHarness`、`X-OpenRouter-Categories: cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL: https://penguin.ooo/` |

请求头由条目 `base_url` 的端点主机名决定，而非其 Provider 分组，因此一个填在 `custom` 分组、base URL 指向上述网关的模型同样会被归因。其余端点不会收到任何额外请求头；条目自身没有 `base_url` 时一律不归因——包括由 `OPENAI_BASE_URL` 指向这些网关的情形。

## TokenDance

新增 `tokendance` 分组，经 Chat Completions（`client_type = "openai-chat"`）访问 `https://tokendance.space/gateway/v1`，凭证留空时回退到 `OPENAI_API_KEY`。随之上线六个预设——`deepseek-v4-flash-0731`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro-0813`、`glm-5.3`、`kimi-k3` 与 `qwen3.8-max`——价格取该网关自己的 CNY 牌价，其中 `qwen3.8-max` 记录的是其进行中的八折促销价（牌价 1.5 / 12 / 36 CNY）。此前创建的 Project 不会自动获得该分组，需在模型库页执行「同步预设」追加。

## Provider 顺序

模型库的 Provider 分组顺序调整为 DeepSeek、OpenRouter、Fireworks AI、Google Gemini、OpenAI、Anthropic、SiliconFlow、TokenDance、Z.AI (GLM)、Moonshot (Kimi)、MiniMax、Qwen Pay-As-You-Go、Qwen Token Plan、Custom。该顺序仅影响展示，渲染时从目录读取，磁盘上的数据没有变化。
