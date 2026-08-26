# Three Flash presets: GLM-5.3 Flash (direct + OpenRouter) and Qwen 3.8 Flash

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `docs`, `skills`
- **PR:** [#469](https://github.com/Prism-Shadow/penguin-harness/pull/469)

[中文版](2026-08-26-flash-model-presets.zh.md)

The built-in model catalog gained three low-cost rows: `glm-5.3-flash` in the direct Z.AI (GLM) group, its gateway listing `z-ai/glm-5.3-flash` on OpenRouter, and `qwen3.8-flash` in the Qwen Pay-As-You-Go group. All three carry a million-token context window and prices roughly an order of magnitude below their non-Flash siblings.

## Details

- **`glm-5.3-flash` (provider `zhipu`)** — display name GLM-5.3 Flash, 1,000,000-token context window, $0.03 / $0.15 / $0.50 per MTok (cache read / cache write / output), read on 2026-08-26 from https://docs.z.ai/guides/overview/pricing and https://docs.z.ai/guides/vlm/glm-5.3-flash. Direct-vendor rows record the vendor's list price, so the row stores it and its comment names the 50% promotion that halves all three rates through 24:00 on 2026-09-09 (UTC+8). Like every direct Z.AI preset it pins neither `client_type` nor `base_url`: AgentHub routes the id by its `glm-5` substring to the unified GLM client, and a blank credential falls back to `ZAI_API_KEY` / `ZAI_BASE_URL`.
- **The direct row is marked `vision = false`** even though the model is natively multimodal. AgentHub's GLM client rejects image parts with `"GLM-5 does not support image inputs."`, the same limitation that keeps `glm-5v-turbo` out of the catalog altogether. The catalog comment states the condition for flipping the flag: a release of `@prismshadow/agenthub`, inside the range core pins, whose `glm5_3` client forwards `image_url` parts.
- **`z-ai/glm-5.3-flash` (provider `openrouter`)** — 1,048,576-token context length, `vision = true`, `client_type = "openai-chat"` and the preset OpenRouter base URL, matching its sibling `z-ai/glm-5.3` row. It sits on a 50%-off ZAI promotion running through 2026-09-09 16:00 UTC; gateway rows store what the gateway actually bills, so the row carries $0.015 / $0.075 / $0.25 and its comment names $0.03 / $0.15 / $0.50 as the rates to restore when the promotion lapses. The same model therefore reaches different answers on the two routes — text-only direct, image-capable through OpenRouter's generic OpenAI-compatible client — and different prices while the promotion runs.
- **`qwen3.8-flash` (provider `qwen-pay-as-you-go`)** — display name Qwen 3.8 Flash, 1,000,000-token input window (131K output cap), `vision = true`, `client_type = "openai-chat"` and the preset DashScope base URL. Official CNY list price from https://www.qianwenai.com/models/qwen3.8-flash, read on 2026-08-26: CNY 1 input / CNY 0.1 cache hit / CNY 3 output per MTok, stored through the catalog's 7:1 display conversion.
- Each row sits at the position the catalog's ordering rule dictates — dictionary order by model id within a provider, newer versions of a series first — so `glm-5.3-flash` follows `glm-5.3`, `z-ai/glm-5.3-flash` follows `z-ai/glm-5.3`, and `qwen3.8-flash` precedes `qwen3.8-max`. Tests pin all three positions along with each row's price, context window, vision flag and protocol pin, and pin that `glm-5.3-flash` still resolves to the `ZAI_*` pair.

## Docs and skill

- The bilingual `models` page names the three ids in its sample of the preset catalog and records why `glm-5.3-flash` is listed twice with different vision flags and, during the promotion, different prices.
- The `agenthub-models` skill (v16) carries the three ids in its model-id table — `glm-5.3-flash` and `z-ai/glm-5.3-flash` in the GLM 5.3 row, `qwen3.8-flash` in a new Qwen 3.8 Flash row — with a note that the direct GLM id is text-only in practice because the GLM client rejects image parts, and names DashScope's endpoint alongside the other Qwen gateways.

## Compatibility

Existing Projects do not pick the presets up on their own: presets are copied into `.project_config.toml` when the Project is created, and nothing rewrites them afterwards. Use **sync presets** on the models page to bring the rows into a Project that already exists — it appends catalog entries the Project is missing and updates catalog-owned fields on the ones it has, deleting nothing and touching neither the stored default model nor any credential.
