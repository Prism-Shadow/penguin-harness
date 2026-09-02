# Doubao Seed models on the TokenDance group

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `model-catalog`, `docs`

[中文版](2026-09-02-doubao-seed-models.zh.md)

The built-in catalog's TokenDance group gained ByteDance's three Doubao Seed chat models: `seed-2.1-pro` (Doubao Seed 2.1 Pro), `seed-2.1-turbo` (Doubao Seed 2.1 Turbo) and `seed-evolving` (Doubao Seed Evolving, a rolling id that currently serves the same model as 2.1 Pro). All three are on the gateway's 50%-off promotion, recorded the way every promoted TokenDance row is — the list price in `pricing`, the rate in `discount` — so the models page shows the billed price with a discount badge, and a Project preset with them charges what the gateway charges.

## Details

- Billed rates (CNY per million tokens, input / output / cache hit): 2.1 Turbo 1.5 / 7.5 / 0.3; 2.1 Pro and Evolving 3 / 15 / 0.6. Context window 256K, image input supported, `openai-chat` on the group's preset base URL like every other TokenDance row.
- Existing Projects pick the rows up through the models page's **sync presets**; new Projects get them on creation.
- The `models` docs page lists the new rows and the group's nine discounted models.
