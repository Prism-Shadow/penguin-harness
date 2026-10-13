# Model catalog refresh: DeepSeek's two listed models, Qwen's own off-peak schedule, new gateway rows

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `docs`, `skills`
- **PR:** [#749](https://github.com/Prism-Shadow/penguin-harness/pull/749)

[中文版](2026-09-16-model-catalog-refresh.zh.md)

The built-in model catalog was re-read against its providers on 2026-09-16. The direct DeepSeek group was cut down to the two models DeepSeek's pricing page lists, three TokenDance promotions were re-rated, OpenRouter, Fireworks AI, SiliconFlow and both Qwen groups gained rows, and the DeepSeek models Qwen sells were put on Qwen's own peak/off-peak schedule, the catalog's second one. Prices below are per million tokens, as cache hit / input / output.

## DeepSeek

- Retired `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` as presets. DeepSeek still accepts both names and serves them from V4.1 Flash at the Flash price, but its pricing page lists only `deepseek-flash` and `deepseek-v4-pro`. Both stay in the catalog as retired rows (see [backward compatibility](2026-09-16-backward-compatibility.md)).
- `deepseek-v4-pro` is now named **DeepSeek V4 Pro 0813**, the release DeepSeek names behind the id. Its peak price stays CNY 0.30 / 9 / 27 on DeepSeek's off-peak schedule, and DeepSeek keeps V4 Pro available after 2026-09-14 with its billing unchanged.
- `deepseek-flash` and the default model were left as they were.

## TokenDance

- Retired `deepseek-v4-flash-vision-exp` as a preset; it stays in the catalog as a retired row, like the DeepSeek pair.
- Re-rated three promotions from the seller's 2026-09-16 quote. `deepseek-v4-flash-0731` lists at CNY 0.15 / 1.5 / 4.5 with 10% off, billed 0.135 / 1.35 / 4.05. `deepseek-v4-pro-0813` lists at CNY 0.45 / 4.5 / 13.5 with 10% off, billed 0.405 / 4.05 / 12.15. `kimi-k3` lists at CNY 1.6 / 20 / 100 with 40% off, billed 0.96 / 12 / 60.

## OpenRouter

- Added `qwen/qwen3.8-27b` (**Qwen 3.8 27B**) at USD 0.15 / 0.214 / 2.55, with a 1,000,000-token context window and image input.

## Fireworks AI

- Added `accounts/fireworks/models/deepseek-v4p1-flash` (**DeepSeek V4.1 Flash**, image input) at USD 0.007 / 0.22 / 0.66 and `accounts/fireworks/models/deepseek-v4-pro-0813` (**DeepSeek V4 Pro 0813**) at USD 0.044 / 1.32 / 3.96, both with a 1,048,576-token context window.
- Added `accounts/fireworks/models/glm-5p3` (**GLM-5.3**) at USD 0.26 / 1.4 / 4.4 and `accounts/fireworks/models/glm-5p3-flash` (**GLM-5.3 Flash**, image input) at USD 0.03 / 0.15 / 0.5, both with a 1,048,576-token context window.
- Added `accounts/fireworks/models/qwen3p8-max` (**Qwen 3.8 Max**, image input) at USD 0.25 / 2 / 6 with a 1,000,000-token context window.

## SiliconFlow

- Added `tencent/Hy4-preview` (**Hy4 preview**) at CNY 0.3 / 6 / 18 with a 1,024,000-token context window, and `zai-org/GLM-5.3` (**GLM-5.3**) at CNY 2 / 8 / 28 with a 1,000,000-token context window. Both are text only.

## Qwen Pay-As-You-Go

- Added `deepseek-v4.1-flash` (**DeepSeek V4.1 Flash**, image input) on Qwen's off-peak schedule, `kimi/kimi-k2.8-preview` (**Kimi K2.8 Preview**, image input) at CNY 1.7 / 6.5 / 27 with a 1,048,576-token context window, and `ZHIPU/GLM-5.3-Flash` (**GLM-5.3 Flash**, image input) at CNY 0.23 / 0.8 / 2.8.
- Removed `deepseek-v4-flash-0731` and `ZHIPU/GLM-5.2`.
- Re-priced `qwen3.8-flash` to Qwen's new list price, CNY 0.1 / 0.8 / 2.7 (it was 0.1 / 1 / 3).

## Qwen Token Plan

- Added `deepseek-v4.1-flash` (**DeepSeek V4.1 Flash**, image input) and `deepseek-v4-pro-0813` (**DeepSeek V4 Pro 0813**, text only), both on Qwen's off-peak schedule; `glm-5.3` (**GLM-5.3**) at CNY 2 / 8 / 28 with a 1,048,576-token context window; and `qwen3.8-flash` (**Qwen 3.8 Flash**, image input) at CNY 0.1 / 0.8 / 2.7.
- Removed `deepseek-v4-flash-0731`, `deepseek-v4-pro` and `glm-5.2`.

## Qwen's off-peak schedule

- The catalog gained a second time-based schedule, `QWEN_OFF_PEAK`: half price from 22:00 to 08:00 Beijing time on every day of the week, read from the peak and off-peak price tabs of each Qwen model page. The three rows on it store their peak price: `deepseek-v4.1-flash` at CNY 0.2 / 2 / 8 (off-peak 0.1 / 1 / 4) in both Qwen groups, and `deepseek-v4-pro-0813` at CNY 0.9 / 9 / 27 (off-peak 0.45 / 4.5 / 13.5) in the Token Plan group. The cost center prices their usage by each record's own timestamp against these windows, as it does for DeepSeek's schedule.
- The tooltip on the models page's off-peak badge named DeepSeek's weekday windows for every scheduled row. Both dictionaries now spell the windows out of the row's own schedule, so a Qwen row reads 08:00–22:00 Beijing time, every day, while a DeepSeek row keeps its weekday text.

## Existing Projects

Presets are copied into a Project when it is created, and the models page's **Sync presets** brings in the added rows and the new prices, but never deletes: a row this refresh removed stays in an existing Project until the user deletes it. The three retired DeepSeek rows keep their names there, and **Sync presets** keeps their prices current without ever adding them to a Project that lacks them, so they are priced on their off-peak schedule whenever they store the catalog price (see [backward compatibility](2026-09-16-backward-compatibility.md)); the removed Qwen rows keep their stored prices and show their raw model id. The new **DeepSeek V4 Pro 0813** name reaches every Project without a sync unless the Project stores a name of its own for `deepseek-v4-pro`, which a sync never overwrites.
