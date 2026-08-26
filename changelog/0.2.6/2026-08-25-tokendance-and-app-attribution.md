# App attribution for OpenRouter and TokenDance, and a TokenDance provider group

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `model-catalog`, `web`, `docs`
- **PR:** [#465](https://github.com/Prism-Shadow/penguin-harness/pull/465)

[中文版](2026-08-25-tokendance-and-app-attribution.zh.md)

Model requests started naming PenguinHarness to the gateways that read an app-attribution header, and the built-in catalog gained a TokenDance provider group with seven presets. The model library's provider groups were resequenced at the same time.

## App attribution

`attributionHeaders` joined the model catalog and was wired into every `GenerativeModel`, which hands it to AgentHub as `defaultHeaders` (a constructor option since `@prismshadow/agenthub` 0.4.7):

| Endpoint | Headers |
| --- | --- |
| `openrouter.ai` | `HTTP-Referer: https://penguin.ooo/`, `X-OpenRouter-Title: PenguinHarness`, `X-OpenRouter-Categories: cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL: https://penguin.ooo/` |

The headers are picked by the endpoint host of the entry's `base_url` rather than by its provider group, so a model filed under `custom` that points at one of those gateways is attributed identically. Every other endpoint receives no extra headers, and an entry carrying no `base_url` of its own is never attributed — including when `OPENAI_BASE_URL` sends it to one of these gateways.

## TokenDance

A `tokendance` group was added, reaching `https://tokendance.space/gateway/v1` over Chat Completions (`client_type = "openai-chat"`) with a blank credential falling back to `OPENAI_API_KEY`. Seven presets shipped with it — `deepseek-v4-flash-0731`, `deepseek-v4-flash-vision-exp`, `deepseek-v4-pro-0813`, `glm-5.3`, `glm-5.3-flash`, `kimi-k3` and `qwen3.8-max` — every one of them at the gateway's own CNY **list** price, the convention the two Qwen groups already follow. Two carry a running promotion, so the group over-states what those two currently bill: `glm-5.3-flash` (0.23 / 0.8 / 2.8 CNY, cache hit / input / output) is on a 2-week 50% off, and `qwen3.8-max` (1.5 / 12 / 36 CNY) on a limited-time 20% off. TokenDance's public catalog API tags both promotions in the model's `description`, so whether one is still running can be re-checked with no credential. `glm-5.3-flash` is multimodal with a 1M context window, and is the group's only model whose upstream serves Chat Completions alone.

Projects created earlier pick none of this up on their own: presets are copied into `.project_config.toml` when a Project is created and nothing rewrites them afterwards. The models page's "sync presets" is the one path — it appends the new presets and updates catalog-owned fields such as pricing on entries already there, without deleting anything or touching a stored default.

## Provider order

The model library's provider groups were resequenced to DeepSeek, OpenRouter, Fireworks AI, Google Gemini, OpenAI, Anthropic, SiliconFlow, TokenDance, Z.AI (GLM), Moonshot (Kimi), MiniMax, Qwen Pay-As-You-Go, Qwen Token Plan, Custom. The order is display-only and is read from the catalog at render time, so nothing on disk changed.
