# TokenDance: DeepSeek V4.1 Flash carries the seller's 20% promotion

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `model-catalog`, `docs`
- **PR:** [#1087](https://github.com/Prism-Shadow/penguin-harness/pull/1087)

[中文版](2026-10-13-tokendance-deepseek-promotion.zh.md)

**Add new models** and new Projects now give TokenDance's `deepseek-v4.1-flash` the 20% TokenDance takes off it on top of DeepSeek's peak/off-peak schedule. Its card shows the saving at every hour, and the cost center bills what TokenDance bills. Models a Project already has are not changed; **Restore defaults** is still the way to put the catalog's promotions on them.

## Details

- A catalog row may declare a promotion beside its off-peak schedule. The two multiply, as they already did for a promotion stored on a Project's row.
- TokenDance's `deepseek-v4.1-flash` declares 20% off. It bills CNY 1.6 / 6.4 / 0.032 (input / output / cache hit) at peak and 0.8 / 3.2 / 0.016 off-peak.
- `deepseek-v4-flash-0731` and `deepseek-v4-pro-0813` take TokenDance's 20% at peak only, which a promotion beside the schedule cannot express. Their peak hours are still billed at the list price.
