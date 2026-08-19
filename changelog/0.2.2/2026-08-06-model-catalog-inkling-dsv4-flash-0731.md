# Models: Inkling and Fireworks DeepSeek V4 Flash 0731 join; gateway GLM-5.1 delisted

- **Date:** 2026-08-06
- **Type:** feature
- **Scope:** `model-catalog`, `skills`, `docs`
- **PR:** [#220](https://github.com/Prism-Shadow/penguin-harness/pull/220), [#230](https://github.com/Prism-Shadow/penguin-harness/pull/230)

[中文版](2026-08-06-model-catalog-inkling-dsv4-flash-0731.zh.md)

Prices and specs read from each model's provider page on 2026-08-06.

## New models

Thinking Machines Lab's Inkling (released 2026-07-14: 1M context, multimodal image + audio input) joins on two gateways: OpenRouter `thinkingmachines/inkling` ($0.17 cached / $1 uncached input / $4.05 output per mtok, read from the models API — the API is authoritative where a model's web page disagrees) and Fireworks AI `accounts/fireworks/models/inkling` ($0.17 cached / $1 uncached input / $4.05 output). Fireworks AI also gains `accounts/fireworks/models/deepseek-v4-flash-0731` ($0.028 / $0.14 / $0.28), placed ahead of the undated flash row per the newer-versions-first ordering rule.

## Delisted

The OpenRouter `z-ai/glm-5.1` and SiliconFlow `Pro/zai-org/GLM-5.1` gateway listings are removed; the Z.AI direct `glm-5.1` stays. Existing Project configs keep working — model entries are copied into `.project_config.toml` at creation and nothing rewrites them on upgrade; delisted presets simply stop being re-added by the models page's "sync presets" action.

## OpenRouter price refresh (2026-08-07)

A follow-up one-pass re-read of the whole OpenRouter group from its models API also refreshed rows that had drifted since 2026-08-03: `deepseek/deepseek-v4-flash` ($0.01764 / $0.0882 / $0.1764), `moonshotai/kimi-k2.6` ($0.0992 / $0.589 / $2.48), `qwen/qwen3.6-35b-a3b` (cache-read $0.05, now published), and `z-ai/glm-5.2` ($0.1261 / $0.679 / $2.134). No row carries a cache-write premium; the no-published-cache-price fallback now covers only the `:free` rows. (`inclusionai/ling-3.0-flash:free` no longer appears in the API listing — left in the catalog pending a delisting decision.)

## Docs and skills

The agenthub-models skill (v11) adds the Inkling and Fireworks 0731 spellings and stops naming the delisted GLM-5.1 gateway ids; the README (en/zh) supported-models tables gain the Inkling family (OpenRouter, Fireworks AI).
