# The DeepSeek V4 Flash price effective 2026-09-10, and a pre-registered V4.1 Flash row

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `core`, `docs`, `skills`
- **PR:** [#649](https://github.com/Prism-Shadow/penguin-harness/pull/649)

[中文版](2026-09-08-deepseek-flash-pricing.zh.md)

DeepSeek adjusted the V4 Flash series price, effective 2026-09-10 12:00 Beijing. The catalog's two
direct V4 Flash rows were re-read on 2026-09-08 and now record the peak tier CNY 0.04 / 2 / 8 per
million tokens (cache hit / cache miss / output), whose off-peak half — 0.02 / 1 / 4 — is applied
from the schedule each row already declares. `deepseek-v4.1-flash`, announced for release after
that date and not served yet, was added at the head of the group at the same price.

## Details

- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` in the `deepseek` group moved from CNY
  0.1 / 3 / 9 to CNY 0.04 / 2 / 8. DeepSeek publishes the vision revision at V4 Flash's own price,
  so the two rows stayed equal. At the catalog's 7:1 storage convention that is USD
  0.005714 / 0.285714 / 1.142857 per million tokens.
- The stored number is still the peak one and `offPeakDiscount: DEEPSEEK_OFF_PEAK` is unchanged,
  so every bucket is still halved outside Beijing weekday 09:00–12:00 and 14:00–18:00, when a
  price is read rather than when it is written.
- `deepseek-v4-pro` kept CNY 0.3 / 9 / 27. The adjustment covers the Flash series only.
- `deepseek-v4.1-flash` (**DeepSeek V4.1 Flash**) was pre-registered at the head of the `deepseek`
  group: image input per DeepSeek's announcement, the V4 Flash price CNY 0.04 / 2 / 8 on the same
  off-peak schedule, and a 1,000,000-token context window assumed from `deepseek-v4-flash` until
  the official model page lists one. Image parts reach it only from the `@prismshadow/agenthub`
  release carrying the DeepSeek client's text-only deny-list; the pinned `^0.4.10` forwards them to
  ids containing `vision` alone.
- The gateway rows reselling DeepSeek — OpenRouter, Fireworks AI, SiliconFlow, TokenDance and the
  two Qwen groups — were left as they were. Each records what its own seller bills, which is not
  the vendor's list price.
- The illustrative `[[models]]` block in the configuration document was moved to the new figures,
  and the sample list in the models document plus the `unified-llm-api` skill's DeepSeek V4 id
  list gained the new row.

## Existing Projects

Presets are copied into `.project_config.toml` when a Project is created and nothing rewrites them
afterwards, so an existing Project keeps the price it stored; the models page's **sync presets** is
what brings the new one in. Until it syncs, a Project still holding the old peak price gets neither
the off-peak split in the cost center nor the `-50%` badge on the models page: both apply only
while the stored price equals the catalog's current peak price (`tieredRates` in
`packages/server/src/services/project-config-service.ts`, `discountedPrice` in
`packages/web/src/features/models/model-grouping.ts`). Because the prices moved and a row was
added, every existing Project sees the preset-update badge until it syncs or dismisses it.
