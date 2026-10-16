# Data compatibility

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `server`, `core`
- **Breaking:** yes — environment keys follow the Project config's `official` flag, and `PENGUIN_GO_API_KEY` / `PENGUIN_GO_BASE_URL` are no longer read

[中文版](2026-10-15-backward-compatibility.zh.md)

## The official flag on existing Projects

A `.project_config.toml` written before the flag gains it once, on the server's first read of the file. The server reads every Project's file as it starts, so this happens before a Session opens one. The old shape tolerated is a first-party vendor group with no `official` key, whether it has a `[providers.<id>]` table or is only named by a model's `provider`. Such a group gets `official = true` when the old rule lent its models a vendor key: its `base_url` is absent or one of the vendor's own endpoints, and its `client_type` is absent or reads the vendor's variable. Otherwise it gets `official = false`. An official group with a base URL and no protocol also gets the vendor's official client as its `client_type`. A group that already has the key, written by this release or by hand, is left alone, and the file is written back once.

Only the server migrates: a file read by the SDK alone keeps no flag, and its keyless models are refused until the file has the flag.

Users act only in the cases the new rule stops covering: a custom or user-created group's keyless model with no base URL, and a keyless model naming a vendor endpoint as its own base URL. They now need a key on the model or its group. Penguin Go users who relied on `PENGUIN_GO_API_KEY` reconnect the group from its header or paste the key into its group settings; no compatibility code reads the variable.

### Lifetime

Remove `markOfficialGroups` and its call in `ProjectConfigService.readTable` at the 0.3.0 release preparation, together with core's `migrateProjectConfigTable`, once the release notes say a Project last opened before this release must be opened once on a 0.2.x server first. Whoever prepares 0.3.0 removes it. The startup sweep (`migrateStoredConfigs`) goes with the last migration it serves.
