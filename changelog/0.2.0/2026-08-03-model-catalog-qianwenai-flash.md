# Models: qianwenai lineup refresh, DeepSeek flash revisions, flash as the seeded default

- **Date:** 2026-08-03
- **Type:** feature
- **Scope:** `model-catalog`, `docs`, `skills`
- **PR:** [#160](https://github.com/Prism-Shadow/penguin-harness/pull/160)

[中文版](2026-08-03-model-catalog-qianwenai-flash.zh.md)

Prices and specs read from each model's page or the gateway's models API on 2026-08-03.

## Qianwenai groups

Qwen Pay-As-You-Go gains `qwen3.8-max` (CNY 1.5/12/36 per mtok, vision) and `deepseek-v4-flash-0731` (CNY 0.2/1/2, text-only; the page lists DeepSeek bare, unlike the `kimi/` and `ZHIPU/` prefixed resales), and drops `qwen3.7-max`. The Qwen Token Plan gains the same two models and drops `qwen3.8-max-preview` and `qwen3.7-max`, while `deepseek-v4-pro`, `glm-5.2` and `qwen3.7-plus` stay; with the preview entry gone, the Token Plan's model-page link no longer needs its fallback carve-out.

## OpenRouter

Gains `deepseek/deepseek-v4-flash-0731` and `openai/gpt-5.6-luna`, and drops `poolside/laguna-m.1:free`, which the models API no longer lists (only the `laguna-s-2.1` / `laguna-xs-2.1` generation remains). Every OpenRouter row's pricing is also re-read in one pass from the models API — the debt the catalog comment had recorded since 2026-07-20: `cache_read` now stores the published cache-hit price wherever one exists, `cache_write` stores the genuine 1.25× per-token write premium on the Anthropic/GPT rows and the input price elsewhere (Gemini's API field is an hourly storage rate, not a per-token price, so those rows keep input), and drifted input/output list prices follow the API (`moonshotai/kimi-k2.6`, `openai/gpt-5.6-terra`, `tencent/hy3`, `z-ai/glm-5.2`, the undated `deepseek/deepseek-v4-flash`).

## SiliconFlow

The three previously unpriced rows (`Pro/moonshotai/Kimi-K2.6`, `Pro/zai-org/GLM-5.1`, `Qwen/Qwen3.6-35B-A3B`) get their official CNY list prices; GLM-5.1 bills in two input-length tiers and the catalog stores the lower one, marked as a floor for long-context use. No catalog entry ships unpriced anymore.

## Default model, docs and skills

The seeded Project default becomes `deepseek` / `deepseek-v4-flash`. Docs follow (models / configuration / quickstart, en/zh); the penguin-sdk skill (v18) names the new preset default its env-only setup path relies on, and agenthub-models (v9) adds the `deepseek/deepseek-v4-flash-0731` OpenRouter spelling; released blog posts that mention the removed free model stay frozen.

## Effect on existing Projects

There is no automatic migration: model entries and the default are copied into `.project_config.toml` when a Project is created, and nothing rewrites them on upgrade. The Web "sync presets" action, when a user runs it explicitly, appends catalog-only rows in catalog order and updates the catalog-owned fields (vision, context window, client type, pricing, base URL) of rows that match a preset — credentials and list positions are kept, nothing is ever deleted, and the stored default is not touched; delisted presets simply stop being re-added. Only newly created Projects see the new lineup and default out of the box.
