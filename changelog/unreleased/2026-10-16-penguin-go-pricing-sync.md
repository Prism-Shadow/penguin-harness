# Refresh Penguin Go prices and promotions during model sync

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1169](https://github.com/Prism-Shadow/penguin-harness/pull/1169)

[中文版](2026-10-16-penguin-go-pricing-sync.zh.md)

Penguin Go's **Sync models** action was updated to refresh existing models' prices and promotions, including preset models whose platform discounts had been cleared by **Restore defaults**.

## Details

- Synchronization and authorization applied the platform's list prices and promotions to existing advertised models, replacing manually edited prices and discounts. An ended platform promotion cleared the model's previous discount.
- List prices were written to `.project_config.toml`, with their corresponding promotion fractions stored in `web.db` for billing.
- Existing names, context and vision settings, output limits, fast mode, keys, selections and user-redirected endpoints were preserved. Models absent from the platform response and other model groups were left unchanged.
- The synchronization result reported both added and updated models, including promotion-only updates. Repeated synchronization with unchanged prices, promotions and routes performed no writes.
- The top-level **Add new models** and **Restore defaults** actions kept their existing behavior. A Go group sync after restoring defaults reapplied the platform's prices and promotions to held presets, including Gemini 4 Argon.
