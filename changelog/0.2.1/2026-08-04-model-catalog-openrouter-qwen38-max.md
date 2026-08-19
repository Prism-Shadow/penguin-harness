# Models: OpenRouter gains qwen/qwen3.8-max

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `model-catalog`, `skills`
- **PR:** [#178](https://github.com/Prism-Shadow/penguin-harness/pull/178)

[中文版](2026-08-04-model-catalog-openrouter-qwen38-max.zh.md)

Prices and specs read from OpenRouter's models API on 2026-08-04.

The OpenRouter group gains `qwen/qwen3.8-max` — USD 2/6 per mtok input/output, cache reads at the published 0.25 hit price, cache writes at the genuine 2.5 (1.25× input) premium, a 1,000,000-token context window, vision — inserted ahead of `qwen/qwen3.6-35b-a3b` per the newer-versions-first ordering. The block's provenance comment now counts it among the rows carrying a real cache-write premium. The catalog already had the model through the qianwenai resale groups; this adds the OpenRouter spelling with OpenRouter's own USD prices.

The agenthub-models skill (v10) adds a Qwen 3.8 Max row recording the OpenRouter id — no other gateway in the catalog resells it, so that column stands alone.

As with every catalog addition there is no automatic migration: existing Projects keep their stored model tables and pick the row up through the models page's explicit "sync presets" action; new Projects see it out of the box.
