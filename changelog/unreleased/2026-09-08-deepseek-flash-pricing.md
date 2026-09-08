# The DeepSeek V4 Flash rows carry the price effective 2026-09-10

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `core`, `docs`

[中文版](2026-09-08-deepseek-flash-pricing.zh.md)

DeepSeek adjusted the V4 Flash series price, effective 2026-09-10 12:00 Beijing. The catalog's two
direct V4 Flash rows were re-read on 2026-09-08 and now record the peak tier CNY 0.04 / 2 / 8 per
million tokens (cache hit / cache miss / output), whose off-peak half — 0.02 / 1 / 4 — is applied
from the schedule each row already declares.

## Details

- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` in the `deepseek` group moved from CNY
  0.1 / 3 / 9 to CNY 0.04 / 2 / 8. DeepSeek publishes the vision revision at V4 Flash's own price,
  so the two rows stayed equal. At the catalog's 7:1 storage convention that is USD
  0.005714 / 0.285714 / 1.142857 per million tokens.
- The stored number is still the peak one and `offPeakDiscount: DEEPSEEK_OFF_PEAK` is unchanged,
  so every bucket is still halved outside Beijing weekday 09:00–12:00 and 14:00–18:00, when a
  price is read rather than when it is written.
- `deepseek-v4-pro` kept CNY 0.3 / 9 / 27. The adjustment covers the Flash series only.
- The gateway rows reselling DeepSeek — OpenRouter, Fireworks AI, SiliconFlow, TokenDance and the
  two Qwen groups — were left as they were. Each records what its own seller bills, which is not
  the vendor's list price.
- The illustrative `[[models]]` block in the configuration document was moved to the new figures.

## Existing Projects

Presets are copied into `.project_config.toml` when a Project is created and nothing rewrites them
afterwards, so an existing Project keeps the price it stored; the models page's **sync presets** is
what brings the new one in. Until it syncs, a Project still holding the old peak price gets neither
the off-peak split in the cost center nor the `-50%` badge on the models page: both apply only
while the stored price equals the catalog's current peak price (`tieredRates` in
`packages/server/src/services/project-config-service.ts`, `discountedPrice` in
`packages/web/src/features/models/model-grouping.ts`). Because the prices moved, a Project holding
either row sees the preset-update badge until it syncs or dismisses it.
