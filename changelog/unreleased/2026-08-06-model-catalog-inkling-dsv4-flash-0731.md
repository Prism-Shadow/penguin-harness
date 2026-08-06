# Models: Inkling and Fireworks DeepSeek V4 Flash 0731 join; gateway GLM-5.1 delisted

Prices and specs read from each model's provider page on 2026-08-06.

## New models

Thinking Machines Lab's Inkling (released 2026-07-14: 1M context, multimodal image + audio input) joins on two gateways: OpenRouter `thinkingmachines/inkling` ($0.95 input / $4.05 output per mtok; the page publishes no cached-input price, so `cache_read` stores the input price per the group's no-discount convention) and Fireworks AI `accounts/fireworks/models/inkling` ($0.17 cached / $1 uncached input / $4.05 output). Fireworks AI also gains `accounts/fireworks/models/deepseek-v4-flash-0731` ($0.028 / $0.14 / $0.28), placed ahead of the undated flash row per the newer-versions-first ordering rule.

## Delisted

The OpenRouter `z-ai/glm-5.1` and SiliconFlow `Pro/zai-org/GLM-5.1` gateway listings are removed; the Z.AI direct `glm-5.1` stays. Existing Project configs keep working — model entries are copied into `.project_config.toml` at creation and nothing rewrites them on upgrade; delisted presets simply stop being re-added by the models page's "sync presets" action.

## Docs and skills

The agenthub-models skill (v11) adds the Inkling and Fireworks 0731 spellings and stops naming the delisted GLM-5.1 gateway ids; the README (en/zh) supported-models tables gain the Inkling family (OpenRouter, Fireworks AI).
