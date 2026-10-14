# Retired models in connection migration tests

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[中文版](2026-10-14-retired-model-migration-test.zh.md)

Fixed the connection migration test to check saved models against the full catalog, including retired models. Existing GPT-5.6 Luna rows remain covered after GPT-6 Luna replaced them in new Project presets. Runtime migration behavior is unchanged.
