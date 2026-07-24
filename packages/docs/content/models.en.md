---
title: Models & Providers
description: Model access through the single AgentHub gateway, (provider, model_id) identity, the per-Project model table, credentials and thinking levels.
---

## One gateway

All model access goes through one gateway library: `@prismshadow/agenthub` (AutoLLMClient). Core defines only a thin `LLMInterface` (see [Interfaces](/interfaces)); per-provider protocol adaptation happens inside AgentHub, so 1000+ online and local models are reachable, including any OpenAI-compatible endpoint. The protocol translation lives in `packages/core/src/llm/generative-model.ts`.

## Model identity

A model's identity is always the `(provider, model_id)` pair: `provider` is a config group name, `model_id` the upstream request id sent to AgentHub unchanged. The two are independent fields — concatenating them into one string is forbidden anywhere in the pipeline.

Every interface that names a model takes the complete pair: the CLI, the HTTP API, and the SDK all reject half a reference instead of completing it. The provider is never inferred from the model id and has no default, because gateways resell vendor models under their upstream ids — a guessed group would send the entry's credential to a vendor nobody named. Where a model reference is optional at all (`penguin run` / `chat`, Session creation, Schedules), the choice is between the whole pair and nothing: omit both halves to take the Project's default model.

## The per-Project model table

Each Project's available models are recorded in the hidden `.project_config.toml`, maintained via the CLI (`penguin config model add / default / list`, see [CLI Reference](/cli)) or the Web UI — never hand-edited. `ModelEntry` fields:

| Field | Meaning |
| --- | --- |
| `provider` | Config group name; paired with `model_id` it forms the unique key |
| `model_id` | Upstream request id |
| `context_window` | Context window |
| `max_tokens` | Optional per-model output cap (max output tokens per request). When set it overrides the Agent's `model.max_tokens`; unset inherits it. Lower it for small-context models: the per-Agent default (32000) cannot fit into e.g. a 32k window together with any prompt. Omitting the field on a Web full-table save clears it |
| `client_type` | Protocol hint (e.g. `openai`); inferred by AgentHub from the model id when omitted |
| `display_name` | Display name |
| `vision` | Whether image input is supported, default true |
| `pricing` | Three price buckets (unit `usd_per_mtok`, USD per million tokens): `cache_read` / `cache_write` / `output` |
| `api_key` / `base_url` | Inlined credentials, both optional; when blank, AgentHub falls back to environment variables |

A fresh Project defaults to deepseek-v4-pro. A `vision_model` entry can additionally designate the proxy model that `describe_image` uses for text-only session models (see [Tools & Approval](/tools)); it is unset by default.

File shape (illustrative):

```toml
default_model = { provider = "deepseek", model_id = "deepseek-v4-pro" }
vision_model = { provider = "google", model_id = "gemini-3.1-pro-preview" }

[[models]]
provider = "deepseek"
model_id = "deepseek-v4-pro"
context_window = 1000000

[[models]]
provider = "custom"
model_id = "my-model"
client_type = "openai"
base_url = "https://llm.example.com/v1"
api_key = "sk-..."
```

For a model tagged `vision = false` (e.g. the DeepSeek series), images from conversation input are saved to the Session scratchpad and handed over as a file path spliced into the text, and the image-reading tool switches to `describe_image`.

## Built-in provider groups

Built-in groups and their env-var fallbacks (catalog source: `packages/core/src/state/model-catalog.ts`); each group also has a `_BASE_URL` variant (e.g. `ANTHROPIC_BASE_URL`):

| Provider | API key env var | Notes |
| --- | --- | --- |
| deepseek | `DEEPSEEK_API_KEY` | Group of the default model |
| openrouter | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://openrouter.ai/api/v1` |
| fireworks | `OPENAI_API_KEY` | Fireworks AI (OpenAI-compatible), preset base URL `https://api.fireworks.ai/inference/v1`; API model ids look like `accounts/fireworks/models/<slug>` |
| siliconflow | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://api.siliconflow.cn/v1` |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan subscription gateway, preset base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; pricing from each model page's official list price (the preview model has only a quota-multiplier promo, no list price) |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen pay-as-you-go (DashScope's OpenAI-compatible endpoint), preset base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`; resold third-party models keep vendor-prefixed ids (e.g. `kimi/kimi-k3`) |
| google | `GEMINI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| custom | `OPENAI_API_KEY` | Any OpenAI-protocol endpoint |

The gateway groups (openrouter / fireworks / siliconflow / qwen-token-plan / qwen-pay-as-you-go) go through AgentHub's OpenAI client, so with blank credentials they read `OPENAI_API_KEY` — not a gateway-specific variable.

Some models in the preset catalog: deepseek-v4-pro / deepseek-v4-flash, gemini-3.1-pro-preview, claude-opus-4-8 / claude-sonnet-4-6, gpt-5.5, glm-5.2, kimi-k2.6, qwen3.8-max-preview (not exhaustive).

## Thinking levels

Five levels: `none | low | medium | high | xhigh`, configured per Agent as `model.thinking_level` in `system_config.yaml`, default medium. The Web pickers offer `low` and above only (many models cannot disable thinking; `none` stays a valid stored value and still displays). The chat draft view offers a quick picker next to the model selector: a picked level is written back to the selected Agent's setting immediately (the switched-to level becomes that Agent's new default and applies from the next session). Inside an active session the thinking level is a **per-turn parameter**: the composer's picker defaults to "follow agent config", and an explicit pick rides on each send (it applies to that session's subsequent Tasks only and never writes back to the Agent config). See [Configuration](/configuration).

## Models decoupled from Agents

An Agent never binds a model: the model is chosen when a Session is created and stays locked for that Session; the same Agent can run different Sessions on different models. The in-session `/model` command changes models by **forking**: it creates a new Session that carries the current conversation (sanitized real history — thinking payloads and provider fidelity never replay across models) and continues there, leaving the source session untouched. The three `pricing` buckets feed the usage/cost center's per-Token accounting.

Credential handling:

- an inline `api_key` is stored in the hidden Project config file with mode 0600;
- the Web UI masks it on display;
- blank credentials fall back to the provider's environment variables.

## Connectivity test

The Web Models page offers a per-model connectivity test (owner only).
