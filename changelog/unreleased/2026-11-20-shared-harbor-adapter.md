# Shared Harbor adapter for external task data

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#1662](https://github.com/Prism-Shadow/penguin-harness/pull/1662)

[中文版](2026-11-20-shared-harbor-adapter.zh.md)

Agent Evaluation can run Harbor tasks from a data repository with the shared Penguin adapter pinned separately. Package imports preserve the external data repository link in `data_url`.

## Compatibility

Evaluations reuse the adapter checkout across datasets. Existing Cases with a bundled adapter continue to run from their original task checkout.
