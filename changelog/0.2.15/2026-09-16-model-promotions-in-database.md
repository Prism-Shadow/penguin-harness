# A Project's model file keeps list prices, and the server stores promotions

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `model-catalog`, `server`, `web`, `docs`
- **PR:** [#716](https://github.com/Prism-Shadow/penguin-harness/pull/716)

[中文版](2026-09-16-model-promotions-in-database.zh.md)

The `pricing` of every model in `.project_config.toml` now holds the list price, in every group. A flat promotion is a fraction the server keeps in a new `model_promotions` table in `web.db`, and cost is computed as list × (1 − discount). Presets and **Sync presets** used to write the discounted number into the file.

## Details

- Three things write promotions: creating a Project (the catalog's promotions are stored with the preset models, and for an adopted `default_project` whenever its presets are written); **Sync presets**, which gives every preset row the catalog's promotion or none (a Penguin Go row keeps the promotion its platform set); and Penguin Go authorization and Sync, which store the platform's.
- `GET /api/projects/:projectId/models` reports a row's promotion as `discount`. `PUT` accepts an optional `discount` per entry: a number between 0 and 1 stores it, `null` clears it, and omitting it keeps the stored one unless the entry renames the row or changes its pricing, which clears it. A row left out of the table loses its promotion. The model dialog notes a running promotion under the price fields and says that changing the price cancels it.
- The cost center, session costs, the chat's live per-turn estimate and company-mode budgets all price usage at the promoted rate. An off-peak tier still applies on top while the stored price is the catalog's peak price, and the card's badge shows the combined saving.
- In core, `presetModelEntries()` writes list prices and the new `presetPromotions()` lists the catalog's flat promotions.
- Database migration 9, `model-promotions`, creates the table. It is swap-safe; its `down` drops every stored promotion.

## Existing Projects

Nothing is migrated. A Project whose file holds discounted numbers from an earlier preset or sync keeps billing at those numbers, without a promotion badge, and the Models page counts those rows as preset updates; running **Sync presets** rewrites them to list prices and stores their promotions. A Project whose presets were written without the server (by the CLI or the SDK) is priced at list until the same sync.
