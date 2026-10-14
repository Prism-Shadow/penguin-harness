# Retain saved OpenCode Go models and pricing

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `model-catalog`
- **PR:** [#1137](https://github.com/Prism-Shadow/penguin-harness/pull/1137)

[中文版](2026-10-14-backward-compatibility.zh.md)

Marked superseded Go rows as retired: new Projects and Add new models no longer add them, while saved rows retain catalog lookups for names, protocols and prices. Older DeepSeek rows retain their off-peak schedule for historical usage. No configuration is rewritten automatically.

These rows follow the retention period in `ModelCatalogEntry.retired`: the catalog maintainer who confirms the seller has stopped accepting an id removes its row only after release notes have warned that historical usage will lose its off-peak pricing.
