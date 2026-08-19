# Model catalog refresh for AgentHub 0.4.2

Built-in model catalog refresh tracking the AgentHub 0.4.2 line-up, the `openai-chat` client rename, and the updated official DeepSeek prices.

## New presets

- **Gemini 3.7** (direct Google group): `gemini-3.7-flash` — 1,048,576-token context, vision, official list price $0.15 / $1.50 / $7.50 per MTok (cache read / input / output; Google's launch discount halves the rates through 2026-12-31 and is not stored, per the catalog's no-promotions policy). Served by AgentHub 0.4.2's native `gemini-3.7` client.
- **GLM-5.3** (direct Z.AI/Zhipu group): 1,000,000-token context, text-only, Z.AI's published price ($0.26 / $1.40 / $4.40 — same as GLM-5.2). Served by AgentHub 0.4.2's unified GLM client.
- **OpenRouter**: `google/gemini-3.7-flash` (the discounted rates OpenRouter actually bills: $0.0375 / $0.375 / $1.875), `x-ai/grok-4.6` ($0.50 / $2 / $6, 500K context, vision), `deepseek/deepseek-v4-pro-0813` (the V4 Pro GA release; official-list USD pricing $0.022 / $0.66 / $1.98, text-only), and `z-ai/glm-5.3` (1,048,576-token context, text-only, $0.26 / $1.40 / $4.40 — the gateway runs no discount, so it matches the direct row to the cent). Prices re-read from the model pages and the per-model endpoints API on 2026-08-18.
- **The full OpenAI line-up, on both sides.** The direct OpenAI group gains the GPT-5.6 generation — `gpt-5.6` (the alias that routes to the sol tier), `gpt-5.6-terra` and `gpt-5.6-luna`, all 1,050,000-token context with vision, at OpenAI's list prices ($0.50 / $5 / $30, $0.20 / $2 / $12 and $0.02 / $0.20 / $1.20) — served by AgentHub 0.4.2's native `gpt-5.6` client. OpenRouter gains the counterparts it was missing: `openai/gpt-5.5-pro`, `openai/gpt-5.4`, `openai/gpt-5.4-mini`, `openai/gpt-5.4-nano` and `openai/gpt-5.4-pro`. Every direct OpenAI model now has an `openai/<id>` gateway row and vice versa, pinned by a test.

## Removals and re-pricing

- Removed the OpenRouter `inclusionai/ling-3.0-flash:free` preset — the model was delisted from OpenRouter. A config that already has it keeps working: nothing is pruned, and the context window, pricing, vision flag, base URL and API key all live in `.project_config.toml` rather than the catalog, so only the display name is lost (the row falls back to showing its upstream id) and the entry stays selectable, editable and valid as the default model. A regression test now pins that.
- Corrected three OpenRouter GPT-5.6 rows that had drifted 2x on the 2026-08-18 re-read: `openai/gpt-5.6-luna` ($0.02 / $0.25 / $1.20) and `openai/gpt-5.6-terra` ($0.20 / $2.50 / $12) were still storing a 50% promotion that has since ended, and `openai/gpt-5.6-sol` ($0.25 / $3.125 / $15) is now running one. Because gateway rows record what OpenRouter bills rather than the vendor's list price, rows sitting on a promotion now name the rate to restore when it lapses.
- Fixes #313: the direct DeepSeek group is re-priced from the updated official list at https://api-docs.deepseek.com/quick_start/pricing/, storing the **off-peak tier** (the lower published price, as the issue requested): `deepseek-v4-flash` ¥0.05 / ¥1.5 / ¥4.5 and `deepseek-v4-pro` ¥0.15 / ¥4.5 / ¥13.5 per MTok (cache hit / input / output; peak hours — Beijing 9:00–12:00 and 14:00–18:00 — bill double). The stale OpenRouter DeepSeek rows were re-read the same day: flash $0.0168 / $0.0679 / $0.168, flash-0731 $0.0157 / $0.0786 / $0.1572, pro $0.022 / $0.66 / $1.98.

## `openai` → `openai-chat` client-type migration

AgentHub 0.4.2 renamed the generic Chat Completions client to `openai-chat` (bare `openai` remains a deprecated upstream alias). The harness now converges on the canonical name end to end:

- Every gateway preset (OpenRouter / Fireworks AI / SiliconFlow / Qwen Token Plan / Qwen Pay-As-You-Go) pins `client_type: "openai-chat"`, except the OpenRouter `openai/*` rows described below; the CLI `model add` group default and the Web add-model dialog produce `openai-chat` too.
- **Existing configs keep working**: a new `canonicalClientType` helper (core) normalizes the stored `openai` spelling on read (core config load, server GET/PUT/test-model handling) and on write (core `addModel`), so pre-rename `.project_config.toml` files load cleanly and migrate to the canonical spelling on their next save.
- The Web protocol-path hint now recognizes AgentHub 0.4.2's generic protocol clients: `openai-responses` maps to `/responses` and `ant-messages` to `/v1/messages` (both previously mis-hinted), and `resolveModelEnv` resolves their env fallbacks (`OPENAI_*` / `ANTHROPIC_*`) plus the GPT-5.6 generation.

## OpenRouter's OpenAI models move to the Responses protocol

OpenRouter serves the OpenAI Responses API at the same `https://openrouter.ai/api/v1` base URL the presets already carry, and AgentHub 0.4.2's `openai-responses` client covers it. The nine `openai/*` OpenRouter presets therefore pin `client_type: "openai-responses"` instead of `openai-chat`, so requests go to `{base}/responses` and reasoning items are round-tripped rather than flattened.

The switch is deliberately limited to the OpenAI family. OpenRouter will translate `/responses` for any upstream, but the Responses client leans on OpenAI-specific reasoning-item semantics (replaying `encrypted_content` / `signature` / `summary` and the assistant `phase`), so every non-OpenAI OpenRouter row — Anthropic, Google, DeepSeek, xAI, Z.AI, Moonshot, MiniMax, Qwen, the `:free` rows and the Free Models Router — stays on Chat Completions, as do all four other gateways (which carry no OpenAI ids). Both protocols read the same `OPENAI_API_KEY` / `OPENAI_BASE_URL`, so credential handling and the env-fallback hint are unchanged; the Web base-URL hint now shows `/responses` for these rows.

Related invariant, now covered by a test: **every** gateway row pins an explicit `client_type`. AgentHub's router matches raw substrings against `client_type || model_id` and never inspects `base_url`, so an unpinned gateway id would be routed by its own spelling — `openai/gpt-5.6-sol` would reach the first-party GPT-5.6 client aimed at a gateway, and the dotted `anthropic/claude-opus-4.8` would throw outright.

## Docs and skill

- `agenthub-models` skill (v12): model-id table synced to the AgentHub 0.4.2 registry (Gemini 3.7, GLM-5.3, the GPT-5.4/5.5/5.6 gateway ids, `z-ai/glm-5.3`, MiniMax M3, Kimi K2.7 Code, new DeepSeek/Claude gateway ids), the routing section documents `openai-chat` / `openai-responses` / `ant-messages` and now warns that gateway ids must always pass an explicit `clientType`, and `fast_mode` (UniConfig) is documented with its per-client support matrix.
- Docs (`models` and `configuration` pages, en+zh): `client_type` examples and the gateway/local-endpoint guidance now say `openai-chat` (with the alias note) and name `openai-responses` / `ant-messages`, the gateway paragraph explains the OpenRouter `openai/*` Responses pin, the free-tier list drops the delisted Ling entry, and the preset examples mention the new models and DeepSeek's off-peak pricing convention.
