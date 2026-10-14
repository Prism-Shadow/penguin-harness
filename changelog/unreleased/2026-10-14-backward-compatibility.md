# Data compatibility

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `server`, `model-catalog`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133), [#1137](https://github.com/Prism-Shadow/penguin-harness/pull/1137)
- **Breaking:** yes — Workflow directories and public contracts become Workbench

[简体中文](2026-10-14-backward-compatibility.zh.md)

## Workbench migration

Existing Agent workbenches are migrated once when accessed. `workflows/` and `workflows-history/` become `workbenches/` and `workbenches-history/`. The module name, interface names, API paths, event names and shared stylesheet use Workbench.

### Compatibility

Migration converts a staged copy before publishing it, preserves `state.json` verbatim and recalculates history revisions so code can still be restored. Originals remain under the Agent's `.workbench-migration/backup/`. An interrupted publication resumes on the next access. A conflicting destination or invalid history stops migration without replacing the original files.

External callers must use `/workbenches` routes and `workbench_updated` / `workbench_removed` events. Old route aliases are not retained. Workbench ids and full-page links remain unchanged. Published tutorial URLs and media URLs remain stable.

### Lifetime

Workbench maintainers retain the migration through 0.2.x. Remove it once the minimum supported data version is 0.3 and upgrades from Workflow builds no longer require conversion. Migration backups remain on disk for recovery.

## Retain saved OpenCode Go models and pricing

Marked superseded Go rows as retired: new Projects and Add new models no longer add them, while saved rows retain catalog lookups for names, protocols and prices. Older DeepSeek rows retain their off-peak schedule for historical usage. No configuration is rewritten automatically.

These rows follow the retention period in `ModelCatalogEntry.retired`: the catalog maintainer who confirms the seller has stopped accepting an id removes its row only after release notes have warned that historical usage will lose its off-peak pricing.
