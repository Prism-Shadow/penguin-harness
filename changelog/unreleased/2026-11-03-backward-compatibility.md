# Backward compatibility in this batch

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `server`
- **PR:** [#1445](https://github.com/Prism-Shadow/penguin-harness/pull/1445)

[中文版](2026-11-03-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Workbenches and their versions in the place they had before Agent State

[Workbenches moved into Agent State](2026-11-03-workbenches-live-in-agent-state.md) and [their versions became git commits](2026-11-03-workbench-versions-are-git-commits.md). Before this batch an Agent kept its workbenches in `<agentDir>/workbenches/<id>/`, and a full copy of each successfully loaded version, up to 20 of them, in `<agentDir>/workbenches-history/<id>/<revision>/`, listed newest first in `versions.json`. Two kinds of old data point there:

- the folders themselves, on every install, the built-in Support app and its tickets among them;
- each Agent's installed copy of the `penguin-plugin` Skill. A copy installed before this batch keeps telling the Agent to write workbenches to `<agentDir>/workbenches/` until the user accepts the plugin update, so Agents go on creating folders in the old place after the upgrade.

Left alone, upgraded installs would have listed no workbenches, the Plugins page would have offered `penguin-support` as not installed, and a workbench an Agent built from its old Skill text would never have appeared.

Chosen (owner's decision): **the server keeps adopting the old place.** Every time it touches an Agent's workbenches (its Workbenches tab, a workbench page, the Agents list, the Agent's plugin list, a plugin install, a company-mode plugin update, an Agent snapshot export or import), it checks `<agentDir>/workbenches/`:

- Each `<id>/` whose id is free under `agent_state/workbenches/` moves in by rename, so its `state.json`, `.harness/` and `.plugin.json` arrive unchanged. While Agent State has no `workbenches/` folder yet, the whole folder moves in one rename.
- Before the folder moves, each version its `versions.json` lists becomes a commit in the Agent State repository (`<agentDir>/agent_state.git`), oldest first, dated with its original `savedAt`; the folder is then committed as the newest version when it differs. History and Restore show the versions and times they showed before the upgrade.
- That id's `<agentDir>/workbenches-history/<id>/` then moves to `<agentDir>/.workbench-migration/backup/workbenches-history/<id>/`, where it stays: no code deletes it.
- An id that is already taken under `agent_state/workbenches/` stays where it is, logged once per server process with the `[workbenches]` prefix. Nothing is overwritten or merged, and listing and loading the Agent's other workbenches carry on.

With nothing in the old place the check costs one failed directory read. A Workflow-era Agent goes through the existing Workflow conversion and then this move in the same access. A version that cannot be read or committed is logged with the `[workbenches]` prefix and left out of the history, with its copy kept; the folder moves regardless. A run cut short is finished by the next access and commits no version twice. The Workflow conversion, which shares `.workbench-migration/`, now clears only its own staging when it starts over, so this backup survives it.

### Scope

Every Agent directory with `workbenches/` beside its `agent_state/`, on every server, machines included, now and whenever such a folder appears later. `workbenches-history/` copies are read only for the ids that move.

### What you need to do

Nothing. A folder left in the old place because its id is taken is named in the server log; rename it, or move it aside, and the next access adopts or ignores it accordingly. Accepting the `agent-development` plugin update on the Agents page brings an Agent's `penguin-plugin` Skill to the new location, after which it no longer writes to the old place.

### Lifetime

The Workbench maintainers keep this until the next major version (1.0) and remove it in that release's preparation: `packages/server/src/workbenches/migrate-state.ts`, its call in `migrateWorkbenches` (`migrate.ts`) and `test/workbench-state-migration.test.ts`, and, with the Workflow conversion already gone at 0.3, `migrateWorkbenches` itself with every await of it (`workbenches/service.ts`, `services/agent-service.ts`, `http/routes/plugins.ts`, `http/routes/agent-transfer.ts`). It is not removed together with the Workflow conversion at 0.3. The backup is never removed by code.

## Compatibility

No action is required on upgrade. A downgrade after the move finds no workbenches in the old place: the older build lists none until `agent_state/workbenches/` is moved back to `<agentDir>/workbenches/` by hand, with its old copies in the backup.
