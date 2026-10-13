# Models: Restore defaults keeps only the API keys

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1093](https://github.com/Prism-Shadow/penguin-harness/pull/1093)

[中文版](2026-10-13-model-restore-defaults.zh.md)

**Restore defaults** on the Models page now gives the Project the model configuration a new Project gets, and keeps only the API keys.

## Details

- Deleted: every model that is not a preset (the ones the user added in any group, and the ones an earlier catalog added and has since dropped, retired rows included) and every group the user created, with their settings, keys and promotions.
- Reset: the presets, in catalog order, with deleted ones back; every built-in group's settings, Custom's and vLLM's base URLs included; promotions; the default model, which becomes the catalog default. The proxy vision model is cleared.
- Penguin Go is reset like every other group: the models its platform added beyond the presets and its promotions are removed, and **Sync models** brings them back.
- Kept: the keys of built-in groups and of preset models, where they were. A key that a deleted model shares with its built-in group's other keyed models, or holds alone, moves to the group when the group has none.
- Usage on a model that is or once was the default of new Projects stays priced after its row is deleted, by restore or by hand: those catalog rows (DeepSeek's `deepseek-flash`, `deepseek-v4-pro`, and the retired `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`) carry a `wasDefault` marker, and the cost center, session cost and a chat turn's cost fall back to their catalog price. Usage on any other deleted model is uncosted, as before.
- The confirmation is one short paragraph, and the result toast no longer counts rows.
