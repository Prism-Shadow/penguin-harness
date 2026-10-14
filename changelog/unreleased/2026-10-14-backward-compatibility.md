# Workbench migration

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `server`
- **Breaking:** yes — Workflow directories and public contracts become Workbench

[简体中文](2026-10-14-backward-compatibility.zh.md)

Existing Agent workbenches are migrated once when accessed. `workflows/` and `workflows-history/` become `workbenches/` and `workbenches-history/`. The module name, interface names, API paths, event names and shared stylesheet use Workbench.

## Compatibility

Migration converts a staged copy before publishing it, preserves `state.json` verbatim and recalculates history revisions so code can still be restored. Originals remain under the Agent's `.workbench-migration/backup/`. An interrupted publication resumes on the next access. A conflicting destination or invalid history stops migration without replacing the original files.

External callers must use `/workbenches` routes and `workbench_updated` / `workbench_removed` events. Old route aliases are not retained. Workbench ids and full-page links remain unchanged. Published tutorial URLs and media URLs remain stable.

## Lifetime

Workbench maintainers retain the migration through 0.2.x. Remove it once the minimum supported data version is 0.3 and upgrades from Workflow builds no longer require conversion. Migration backups remain on disk for recovery.
