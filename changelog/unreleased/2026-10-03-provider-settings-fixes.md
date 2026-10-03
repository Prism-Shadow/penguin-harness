# Group settings: base URL check, save-time detection and dismissal fixes

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`, `web`, `cli`
- **PR:** [#967](https://github.com/Prism-Shadow/penguin-harness/pull/967)

[中文版](2026-10-03-provider-settings-fixes.zh.md)

Three defects in [group connections](2026-10-02-provider-connection.md) were fixed: a group base URL was stored without being checked, the group settings dialog skipped its save-time protocol detection too eagerly, and a save dismissed during that detection still wrote.

## Details

- A group base URL that is set must be an absolute http(s) URL. `PUT /api/projects/:projectId/models/providers/:provider` and the `providers` member of `PUT /api/projects/:projectId/models` answered anything else with a 400 (`bad_request`) and wrote nothing; a blank value still cleared the field. `penguin config model add --provider <group> --base-url <url>` without `--model-id` refused such a value in both languages, and the group settings dialog refused to save it, with the reason under the base URL field.
- The group settings dialog of a custom or user-defined group left on "Not set" probed the endpoint on Save whenever some model of the group stored no protocol of its own, or the group had no model yet. Previously one model with its own protocol was enough to skip the probe, and the other models were left on no protocol.
- The group settings dialog could not be closed (Cancel, Esc, the backdrop, ×) while a save, its save-time detection included, was in flight. A save whose dialog was taken down before the write sent no `PUT`.
