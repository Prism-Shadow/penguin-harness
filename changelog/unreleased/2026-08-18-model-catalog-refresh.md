# Model catalog refresh for AgentHub 0.4.2

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `web`, `cli`, `skills`
- **PR:** [#325](https://github.com/Prism-Shadow/penguin-harness/pull/325)
- **Issue:** [#313](https://github.com/Prism-Shadow/penguin-harness/issues/313)

[中文版](2026-08-18-model-catalog-refresh.zh.md)

The built-in model catalog was refreshed against the AgentHub 0.4.2 line-up: Gemini 3.7, GLM-5.3 and the GPT-5.6 generation joined the direct provider groups along with their OpenRouter counterparts, a delisted free row was dropped, the DeepSeek rows were re-priced from the current official list, and the generic Chat Completions client type was renamed to `openai-chat`.

## New presets

- **Gemini 3.7** — `gemini-3.7-flash` in the direct Google group: 1,048,576-token context, vision, $0.15 / $1.50 / $7.50 per MTok (cache read / input / output), served by AgentHub 0.4.2's native `gemini-3.7` client. Google's launch discount halves those rates through 2026-12-31 and is not stored, following the catalog's convention of keeping direct rows on list price.
- **GLM-5.3** — the direct Z.AI group gained a 1,000,000-token, text-only row at Z.AI's published $0.26 / $1.40 / $4.40, the same rates as GLM-5.2, served by AgentHub 0.4.2's unified GLM client.
- **GPT-5.6** — the direct OpenAI group gained `gpt-5.6` (the bare id routes to the sol tier upstream and is priced as that tier), `gpt-5.6-terra` and `gpt-5.6-luna`, all 1,050,000-token context with vision, at $0.50 / $5 / $30, $0.20 / $2 / $12 and $0.02 / $0.20 / $1.20, served by the native `gpt-5.6` client.
- **OpenRouter counterparts** — `google/gemini-3.7-flash` at the discounted rates the gateway actually bills ($0.0375 / $0.375 / $1.875), `z-ai/glm-5.3` ($0.26 / $1.40 / $4.40, matching the direct row to the cent, as the gateway runs no discount on it), `x-ai/grok-4.6` ($0.50 / $2 / $6, 500K context, vision) and `deepseek/deepseek-v4-pro-0813` ($0.022 / $0.66 / $1.98, text-only). The five missing OpenAI ids — `openai/gpt-5.5-pro`, `openai/gpt-5.4`, `openai/gpt-5.4-mini`, `openai/gpt-5.4-nano` and `openai/gpt-5.4-pro` — were added, so every direct OpenAI model has an `openai/<id>` gateway row and vice versa; a new test pins that parity. All rates were re-read on 2026-08-18 from the model pages and the per-model endpoints API.

## Removals and re-pricing

- The `inclusionai/ling-3.0-flash:free` OpenRouter preset was removed after the model was delisted upstream, and the free-model docs list dropped it.
- The direct DeepSeek group was re-priced from the updated official list at https://api-docs.deepseek.com/quick_start/pricing/, storing the off-peak tier — the lower published price: `deepseek-v4-flash` at ¥0.05 / ¥1.5 / ¥4.5 and `deepseek-v4-pro` at ¥0.15 / ¥4.5 / ¥13.5 per MTok (cache hit / input / output). Peak hours, Beijing 09:00–12:00 and 14:00–18:00, bill double.
- The stale OpenRouter DeepSeek rows were re-read the same day: `deepseek/deepseek-v4-flash` $0.0168 / $0.0679 / $0.168, `deepseek/deepseek-v4-flash-0731` $0.0157 / $0.0786 / $0.1572 and `deepseek/deepseek-v4-pro` $0.022 / $0.66 / $1.98.
- Three OpenRouter GPT-5.6 rows that had drifted by 2x were corrected on that re-read: `openai/gpt-5.6-luna` ($0.02 / $0.25 / $1.20) and `openai/gpt-5.6-terra` ($0.20 / $2.50 / $12) were still storing a promotion that has since lapsed, and `openai/gpt-5.6-sol` ($0.25 / $3.125 / $15) moved onto one. Gateway rows record what OpenRouter bills rather than the vendor's list price, so each discounted row now names the rate to restore when its promotion ends.

## OpenRouter's OpenAI rows on the Responses protocol

The nine `openai/*` OpenRouter presets pin `client_type: "openai-responses"` in place of `openai-chat`, so their requests go to `{base}/responses` and reasoning items are round-tripped rather than flattened. OpenRouter serves the Responses API at the same `https://openrouter.ai/api/v1` base URL those presets already carry, and AgentHub 0.4.2's `openai-responses` client speaks it.

The pin is limited to the OpenAI family. The Responses client leans on OpenAI-specific reasoning-item semantics — replaying `encrypted_content` / `signature` / `summary` and the assistant `phase` — so every non-OpenAI OpenRouter row (Anthropic, Google, DeepSeek, xAI, Z.AI, Moonshot, MiniMax, Qwen, the `:free` rows and the Free Models Router) stayed on Chat Completions, as did the four other gateways, which carry no OpenAI ids. Both protocols read the same `OPENAI_API_KEY` / `OPENAI_BASE_URL`, so credential handling and the env-var fallback were left unchanged; the Web base-URL hint shows `/responses` for these rows.

A new test pins the related invariant that every gateway row carries an explicit `client_type`. AgentHub's router matches raw substrings against `client_type || model_id` and never inspects `base_url`, so an unpinned gateway id would be routed by its own spelling: `openai/gpt-5.6-sol` would reach the first-party GPT-5.6 client pointed at a gateway, and the dotted `anthropic/claude-opus-4.8` would throw outright.

## `openai-chat` client type

AgentHub 0.4.2 renamed the generic Chat Completions client to `openai-chat`, keeping bare `openai` as a deprecated alias. The harness converged on the canonical name end to end:

- Every gateway preset — OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan and Qwen Pay-As-You-Go — pins `client_type: "openai-chat"`, apart from the OpenRouter `openai/*` rows above. The CLI `model add` group default and the Web add-model dialog emit `openai-chat` as well.
- The Web protocol-path hint learned AgentHub 0.4.2's generic protocol clients: `openai-responses` maps to `/responses` and `ant-messages` to `/v1/messages`, both previously mis-hinted, and `resolveModelEnv` resolves their env fallbacks (`OPENAI_*` / `ANTHROPIC_*`) as well as the GPT-5.6 generation.

## Compatibility

The rename does not break stored configuration. A new core helper, `canonicalClientType`, normalizes the `openai` spelling on read — core config load, and the server's model GET, PUT and test-model paths — and on write in core's `addModel`, so a pre-rename `.project_config.toml` loads and runs unchanged and picks up the canonical spelling the next time it is saved. Bare `openai` also remains a working alias upstream in AgentHub.

Removing the Ling preset leaves existing Projects alone as well: presets are copied into `.project_config.toml` at creation and nothing rewrites them, and "sync presets" appends and updates catalog-owned fields without deleting. A config already holding the row keeps its context window, pricing, vision flag, base URL and API key — all of which live in the config rather than the catalog — so only the catalog display name is lost, the row falls back to showing its upstream id, and it stays selectable, editable and valid as the default model. A regression test pins that.

## Docs and skill

- The `agenthub-models` skill (v12) synced its model-id table to the AgentHub 0.4.2 registry — Gemini 3.7, GLM-5.3, the GPT-5.4/5.5/5.6 gateway ids, `z-ai/glm-5.3`, MiniMax M3, Kimi K2.7 Code and the new DeepSeek and Claude gateway ids. Its routing section documents `openai-chat`, `openai-responses` and `ant-messages`, warns that gateway ids must always pass an explicit `clientType`, and documents `fast_mode` (UniConfig) with its per-client support matrix.
- The bilingual `models` and `configuration` docs pages moved their `client_type` examples and their gateway and local-endpoint guidance to `openai-chat` (with a note on the alias), named `openai-responses` and `ant-messages`, explained the OpenRouter `openai/*` Responses pin, and mentioned the new models and DeepSeek's off-peak pricing convention.
