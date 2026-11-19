# Persistent app storage conventions and `WorkbenchHost.dataPaths()`

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[中文版](2026-11-17-workbench-files.zh.md)

Workbenches now expose `host.dataPaths(opts?)` returning their persistent app storage directories (`{ appId, level, dataDir, cacheDir, stateDir }`, defaulting to `<agentId>.<workbenchId>` at `agent` level and supporting `project`, `server` and `machine` levels), and the `penguin-plugin` skill documents configuration and four-level persistent data conventions.

## Details

- `WorkbenchHost.dataPaths(opts?)` returns `{ appId, level, dataDir, cacheDir, stateDir }` under `<scope>/app/{data,cache,state}/<app_id>` across `agent` (default), `project`, `server` and `machine` levels.
- `isWorkbenchId` now aligns with `WORKBENCH_NAME_PATTERN` by disallowing `.` (so `<agentId>.<workbenchId>` is unambiguous), and `projectId`, `agentId` and `workbenchId` validation rejects Windows reserved device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`).
- `SandboxService.confinerFor` binds the Agent's `agent`-level `<scope>/app` storage root as writable by default alongside the Session scratchpad under `workspace-write`.
- `penguin-plugin` (`SKILL.md`) adds a `Data and storage` section covering `Adding configuration` (`PluginConfigProvider.groups`, `PluginConfig`, Agent Vault) and `Managing persistent data` (`agent`, `project`, `server`, `machine` scopes, reverse-domain `app_id` vs. `<agentId>.<workbenchId>`, and defaulting to `agent` scope unless the user consents to shared storage).
