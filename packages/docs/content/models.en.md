---
title: Models & Providers
description: Model access through the single AgentHub gateway, (provider, model_id) identity, the per-Project model table, credentials and thinking levels.
---

## One gateway

All model access goes through one gateway library: `@prismshadow/agenthub` (AutoLLMClient). Core defines only a thin `LLMInterface` (see [Interfaces](/interfaces)); per-provider protocol adaptation happens inside AgentHub, so 1000+ online and local models are reachable, including any OpenAI-compatible endpoint. The protocol translation lives in `packages/core/src/llm/generative-model.ts`.

## Model identity

A model's identity is always the `(provider, model_id)` pair: `provider` is a config group name, `model_id` the upstream request id sent to AgentHub unchanged. The two are independent fields — concatenating them into one string is forbidden anywhere in the pipeline.

## The per-Project model table

Each Project's available models are recorded in the hidden `.project_config.toml`, maintained via the CLI (`penguin config model add / default / list`, see [CLI Reference](/cli)) or the Web UI — never hand-edited. `ModelEntry` fields:

| Field | Meaning |
| --- | --- |
| `provider` | Config group name; paired with `model_id` it forms the unique key |
| `model_id` | Upstream request id |
| `context_window` | Context window |
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
| siliconflow | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://api.siliconflow.cn/v1` |
| google | `GEMINI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| custom | `OPENAI_API_KEY` | Any OpenAI-protocol endpoint |

The gateway groups (openrouter / siliconflow) go through AgentHub's OpenAI client, so with blank credentials they read `OPENAI_API_KEY` — not a gateway-specific variable.

Some models in the preset catalog: deepseek-v4-pro / deepseek-v4-flash, gemini-3.1-pro-preview, claude-opus-4-8 / claude-sonnet-4-6, gpt-5.5, glm-5.2, kimi-k2.6 (not exhaustive).

## Thinking levels

Five levels: `none | low | medium | high | xhigh`, configured per Agent as `model.thinking_level` in `system_config.yaml`, default medium. See [Configuration](/configuration).

## Models decoupled from Agents

An Agent never binds a model: the model is chosen when a Session is created and stays locked for that Session; the same Agent can run different Sessions on different models. The three `pricing` buckets feed the usage/cost center's per-Token accounting.

Credential handling:

- an inline `api_key` is stored in the hidden Project config file with mode 0600;
- the Web UI masks it on display;
- blank credentials fall back to the provider's environment variables.

## Connectivity test

The Web Models page offers a per-model connectivity test (owner only).
