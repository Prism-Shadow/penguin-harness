# The discount badge says what it means

- **Date:** 2026-09-02
- **Type:** fix
- **Scope:** `web`, `docs`

[中文版](2026-09-02-discount-badge-wording.zh.md)

The models page's discount badge read `-50%`, a figure with no word beside it to say what was fifty percent less than what. It now reads `50% off` in English and `50% 优惠` in Chinese; the hover text saying whether the rate is a running promotion or an off-peak schedule is unchanged.

## Details

- `models.discountBadge` renders the new wording in both dictionaries; the `models` docs page describes the DeepSeek off-peak mark with it.
