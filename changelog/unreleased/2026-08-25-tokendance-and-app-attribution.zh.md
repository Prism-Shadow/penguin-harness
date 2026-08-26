# OpenRouter 与 TokenDance 的应用归因，以及新增 TokenDance 分组

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `model-catalog`, `web`, `docs`
- **PR:** [#465](https://github.com/Prism-Shadow/penguin-harness/pull/465)

[English](2026-08-25-tokendance-and-app-attribution.md)

模型请求开始向读取应用归因请求头的网关声明 PenguinHarness，内置目录新增 TokenDance 分组及其七个预设。模型库的 Provider 分组顺序同时做了调整。

## 应用归因

模型目录新增 `attributionHeaders`，并接入每一个 `GenerativeModel`——由它作为 `defaultHeaders` 传给 AgentHub（`@prismshadow/agenthub` 0.4.7 起提供的构造参数）：

| 端点 | 请求头 |
| --- | --- |
| `openrouter.ai` | `HTTP-Referer: https://penguin.ooo/`、`X-OpenRouter-Title: PenguinHarness`、`X-OpenRouter-Categories: cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL: https://penguin.ooo/` |

请求头由条目 `base_url` 的端点主机名决定，而非其 Provider 分组，因此一个填在 `custom` 分组、base URL 指向上述网关的模型同样会被归因。其余端点不会收到任何额外请求头；条目自身没有 `base_url` 时一律不归因——包括由 `OPENAI_BASE_URL` 指向这些网关的情形。

## TokenDance

新增 `tokendance` 分组，经 Chat Completions（`client_type = "openai-chat"`）访问 `https://tokendance.space/gateway/v1`，凭证留空时回退到 `OPENAI_API_KEY`。随之上线七个预设——`deepseek-v4-flash-0731`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro-0813`、`glm-5.3`、`glm-5.3-flash`、`kimi-k3` 与 `qwen3.8-max`——一律记该网关自己的 CNY **牌价**，与下方两个 Qwen 分组口径一致。其中两个正在促销，因此该分组当前高估了这两行的实际计费：`glm-5.3-flash`（0.23 / 0.8 / 2.8 CNY，缓存命中 / 输入 / 输出）正在限时两周五折，`qwen3.8-max`（1.5 / 12 / 36 CNY）正在限时八折。TokenDance 的公开模型目录 API 会把这两个促销标注在模型的 `description` 里，因此无需凭证即可复核促销是否仍在进行。`glm-5.3-flash` 支持多模态输入，上下文窗口 1M，也是该分组中唯一只提供 Chat Completions 协议的模型。

此前创建的 Project 不会自动获得上述任何改动：预设是在 Project 创建时复制进 `.project_config.toml` 的，此后不会被改写。唯一的途径是模型库页的「同步预设」——它追加新预设，并更新已有条目上归目录所有的字段（如价格），既不删除任何内容，也不改动已存的默认模型。

## Provider 顺序

模型库的 Provider 分组顺序调整为 DeepSeek、OpenRouter、Fireworks AI、Google Gemini、OpenAI、Anthropic、SiliconFlow、TokenDance、Z.AI (GLM)、Moonshot (Kimi)、MiniMax、Qwen Pay-As-You-Go、Qwen Token Plan、Custom。该顺序仅影响展示，渲染时从目录读取，磁盘上的数据没有变化。
