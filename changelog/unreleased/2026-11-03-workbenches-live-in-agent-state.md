# Workbenches live in Agent State

- **Date:** 2026-11-03
- **Type:** refactor
- **Scope:** `core`, `server`
- **PR:** [#1442](https://github.com/Prism-Shadow/penguin-harness/pull/1442)

[中文版](2026-11-03-workbenches-live-in-agent-state.zh.md)

An Agent's workbenches moved from `<agentDir>/workbenches/<id>/` into its Agent State, at `<agentDir>/agent_state/workbenches/<id>/`, beside its Skills and hooks. The folder's contents did not change: source, `ui/`, `state.json`, and the server's `.harness/` and `.build/`. Folders in the old place are moved in on first access; see [backward compatibility](2026-11-03-backward-compatibility.md).

## Details

- Core added `workbenchesDir(root, projectId, agentId)` for the new path. A plugin's workbench installs there, and the server's workbench store, its watcher and the Agents list's `workbenchCount` read from there.
- Because the workbenches now sit in Agent State, Agent State snapshots and an Agent's export and import carry them, `state.json` included.
- An Agent without workbenches still has no `workbenches/` folder until the first one is made or installed.
