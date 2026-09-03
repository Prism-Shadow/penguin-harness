# Clearing error records names its range and takes what the panel showed

- **Date:** 2026-09-02
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#590](https://github.com/Prism-Shadow/penguin-harness/pull/590)
- **Breaking:** yes — `GET /usage` no longer returns `errors.clearable`, and a `DELETE /usage/errors` missing either date bound is refused with 400 instead of clearing the whole history

[中文版](2026-09-02-cost-center-clear-range.zh.md)

The cost center's **Clear** confirmation now names the range the way the picker does — "in the last 7 days", "in the last hour" — and spells out dates only for a custom range. Behind it, a clear now deletes exactly the rows the panel listed: the two trailing presets (last hour, last 24 hours) narrow the error table's reads and the clear alike to their instant window instead of to whole days, and an admin's clear takes the unattributed rows an admin's panel shows — login failures and process crashes with no Project — which a Project-scoped clear used to leave behind.

## Details

- `GET` and `DELETE /api/projects/:projectId/usage/errors` accept `fromTs` / `toTs` (both or neither, in order, like the dashboard); the dashboard's error statistics honour the pair too. Both bounds are inclusive. The clear additionally requires `from` and `to` (400 otherwise), as the panel already required them before offering the action — an open bound is the whole history rather than a filter.
- The delete reaches exactly what the caller's reads reach: an admin's clear includes unattributed rows, a member's (whose reads never show them) never does. `UsageErrors.clearable`, which counted the difference, is gone — `total` is what a clear takes.
- New strings `usage.errorsClearRangePreset` / `usage.errorsClearRangeCustom` feed `usage.errorsClearScope` and `usage.errorsClearScopeAgent`, which now take the range as one phrase.
- The Web App and server API docs describe the clear's reach.

## Compatibility

- `GET /api/projects/:projectId/usage` no longer returns `errors.clearable`. Read `errors.total`, which is now the count a clear takes. The Web App ships with the server, so a user has nothing to do; an API client reading `clearable` switches to `total`.
- `DELETE /api/projects/:projectId/usage/errors` answers 400 when `from` or `to` is missing, where such a call used to clear the Project's whole error history. Send both bounds — the range the panel is showing.
