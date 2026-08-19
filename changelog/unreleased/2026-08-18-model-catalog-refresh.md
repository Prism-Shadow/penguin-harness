# Model catalog refresh for AgentHub 0.4.2

Built-in model catalog refresh tracking the AgentHub 0.4.2 line-up, the `openai-chat` client rename, and the updated official DeepSeek prices.

## New presets

- **Gemini 3.7** (direct Google group): `gemini-3.7-flash` — 1,048,576-token context, vision, official list price $0.15 / $1.50 / $7.50 per MTok (cache read / input / output; Google's launch discount halves the rates through 2026-12-31 and is not stored, per the catalog's no-promotions policy). Served by AgentHub 0.4.2's native `gemini-3.7` client.
- **GLM-5.3** (direct Z.AI/Zhipu group): 1,000,000-token context, text-only, Z.AI's published price ($0.26 / $1.40 / $4.40 — same as GLM-5.2). Served by AgentHub 0.4.2's unified GLM client.
- **OpenRouter**: `google/gemini-3.7-flash` (the halved launch-discount rates OpenRouter actually bills: $0.075 / $0.75 / $3.75), `x-ai/grok-4.6` ($0.50 / $2 / $6, 500K context, vision), and `deepseek/deepseek-v4-pro-0813` (the V4 Pro GA release; official-list USD pricing $0.022 / $0.66 / $1.98, text-only). Prices re-read from the model pages and the per-model endpoints API on 2026-08-18.

## Removals and re-pricing

- Removed the OpenRouter `inclusionai/ling-3.0-flash:free` preset — the model was delisted from OpenRouter.
- Fixes #313: the direct DeepSeek group is re-priced from the updated official list at https://api-docs.deepseek.com/quick_start/pricing/, storing the **off-peak tier** (the lower published price, as the issue requested): `deepseek-v4-flash` ¥0.05 / ¥1.5 / ¥4.5 and `deepseek-v4-pro` ¥0.15 / ¥4.5 / ¥13.5 per MTok (cache hit / input / output; peak hours — Beijing 9:00–12:00 and 14:00–18:00 — bill double). The stale OpenRouter DeepSeek rows were re-read the same day: flash $0.0168 / $0.0679 / $0.168, flash-0731 $0.0157 / $0.0786 / $0.1572, pro $0.022 / $0.66 / $1.98.

## `openai` → `openai-chat` client-type migration

AgentHub 0.4.2 renamed the generic Chat Completions client to `openai-chat` (bare `openai` remains a deprecated upstream alias). The harness now converges on the canonical name end to end:

- Every gateway preset (OpenRouter / Fireworks AI / SiliconFlow / Qwen Token Plan / Qwen Pay-As-You-Go) pins `client_type: "openai-chat"`; the CLI `model add` group default and the Web add-model dialog produce it too.
- **Existing configs keep working**: a new `canonicalClientType` helper (core) normalizes the stored `openai` spelling on read (core config load, server GET/PUT/test-model handling) and on write (core `addModel`), so pre-rename `.project_config.toml` files load cleanly and migrate to the canonical spelling on their next save.
- The Web protocol-path hint now recognizes AgentHub 0.4.2's generic protocol clients: `openai-responses` maps to `/responses` and `ant-messages` to `/v1/messages` (both previously mis-hinted), and `resolveModelEnv` resolves their env fallbacks (`OPENAI_*` / `ANTHROPIC_*`) plus the GPT-5.6 generation.

## Docs and skill

- `agenthub-models` skill (v12): model-id table synced to the AgentHub 0.4.2 registry (Gemini 3.7, GLM-5.3, GPT-5.6 variants, MiniMax M3, Kimi K2.7 Code, new DeepSeek/Claude gateway ids), the routing section documents `openai-chat` / `openai-responses` / `ant-messages`, and `fast_mode` (UniConfig) is documented with its per-client support matrix.
- Docs (`models` and `configuration` pages, en+zh): `client_type` examples and the gateway/local-endpoint guidance now say `openai-chat` (with the alias note), the free-tier list drops the delisted Ling entry, and the preset examples mention the new models and DeepSeek's off-peak pricing convention.
