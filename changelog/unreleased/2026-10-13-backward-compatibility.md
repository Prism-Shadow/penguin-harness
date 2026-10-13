# Agent API settings database upgrade

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)

[中文版](2026-10-13-backward-compatibility.zh.md)

Added migration 17 to extend existing `agent_api` rows with nullable model, thinking-level and workspace columns. Existing API switches, approval modes and keys are preserved. Unset fields keep the previous session-creation defaults; no reset is required.

Migration 18 added the concurrency column with the previous limit of 4, preserving the settings and keys from version 17.

## Retention

Keep migration 17 until the minimum supported database baseline exceeds version 16. The maintainer raising that baseline removes the upgrade after every supported data root already has the new columns. Rolling back leaves the extra columns and their saved values in place; older builds ignore them.

Keep migration 18 until the minimum supported database baseline exceeds version 17. The maintainer raising that baseline removes it once every supported data root has the column. Rollback retains the stored limit.
