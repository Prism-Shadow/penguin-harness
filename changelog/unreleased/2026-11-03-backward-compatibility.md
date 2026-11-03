# Backward compatibility in this batch

- **Date:** 2026-11-03
- **Type:** process
- **Scope:** `server`

[中文版](2026-11-03-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Workbenches and their versions in the layout before Agent State

[Workbenches moved into Agent State](2026-11-03-workbenches-live-in-agent-state.md) and [their versions became git commits](2026-11-03-workbench-versions-are-git-commits.md). Before this batch an Agent kept its workbenches in `<agentDir>/workbenches/<id>/`, and a full copy of each successfully loaded version, up to 20 of them, in `<agentDir>/workbenches-history/<id>/<revision>/`, listed newest first in `versions.json`. Left alone, every upgraded install would have listed no workbenches, the built-in Support app and its tickets among them, and the Plugins page would have offered `penguin-support` as not installed.

Chosen (owner's decision): **a one-time migration that keeps the history.** The first time the server touches an Agent's workbenches (its Workbenches tab, a workbench page, the Agents list, the Agent's plugin list, a plugin install, a company-mode plugin update):

- `<agentDir>/workbenches/` moves into `agent_state/workbenches/` in one rename, so each workbench's `state.json`, `.harness/` and `.plugin.json` arrive unchanged.
- Each version `versions.json` lists becomes a commit in `agent_state/.git`, oldest first, dated with its original `savedAt`; the live folder is then committed as the newest version when it differs. History and Restore show the versions and times they showed before the upgrade.
- `<agentDir>/workbenches-history/` moves to `<agentDir>/.workbench-migration/backup/workbenches-history/`, where it stays: no code deletes it.

An Agent with neither old directory is not touched, and gets no journal. A Workflow-era Agent goes through the existing Workflow conversion and then this move in the same access. A version that cannot be read or committed is logged with the `[workbenches]` prefix and left out of the history, its copy staying in the backup; the workbench moves regardless.

### Scope

Every Agent directory with `workbenches/` or `workbenches-history/` beside its `agent_state/`, on every server, machines included. The journal is `<agentDir>/.workbench-migration/` (`state-started`, `state-complete`), shared with the Workflow conversion, and a migration that was interrupted is finished by the next access. The Workflow conversion, when it starts over, now clears only its own staging in that directory, so this backup survives it.

### What you need to do

Nothing. If an Agent has both `<agentDir>/workbenches/` and `agent_state/workbenches/`, the migration stops before moving anything and the Workbenches tab names the conflict; move one of them aside and reload. Nothing is overwritten.

### Lifetime

The Workbench maintainers keep this migration until the next major version (1.0) and remove it in that release's preparation: `packages/server/src/workbenches/migrate-state.ts`, its call in `migrateWorkbenches` (`migrate.ts`) and `test/workbench-state-migration.test.ts`, and, with the Workflow conversion already gone at 0.3, `migrateWorkbenches` itself with every await of it (`workbenches/service.ts`, `services/agent-service.ts`, `http/routes/plugins.ts`). It is not removed together with the Workflow conversion at 0.3. The backup is never removed by code.

## Compatibility

No action is required on upgrade. A downgrade after the migration finds no workbenches in the old place: the older build lists none until `agent_state/workbenches/` is moved back to `<agentDir>/workbenches/` by hand, with its old copies in the backup.
