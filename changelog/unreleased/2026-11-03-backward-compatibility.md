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
- each Agent's installed copy of the `penguin-plugin` Skill. A copy installed before this batch keeps telling the Agent to write workbenches to `<agentDir>/workbenches/` until the user accepts the plugin update.

Left alone, upgraded installs would have listed no workbenches, the Plugins page would have offered `penguin-support` as not installed, and a workbench an Agent built from its old Skill text would never have appeared.

Chosen (owner's decision): **move the folders in, then leave a link in the old place.** Every time the server touches an Agent's workbenches (its Workbenches tab, a workbench page, the Agents list, the Agent's plugin list, a plugin install, a company-mode plugin update, an Agent snapshot export or import), it looks at `<agentDir>/workbenches` with one `lstat`. Absent, or already a link, there is nothing more to do. A real directory is handled like this:

- Each `<id>/` moves into `agent_state/workbenches/` by rename, so its `state.json`, `.harness/` and `.plugin.json` arrive unchanged, once three things hold: it has a `package.json`; none of its source files changed in the last 10 minutes, so a folder an Agent is still writing is left alone; and its id is free there, compared without case or Unicode form.
- Before the folder moves, each version its `versions.json` lists becomes a commit in the Agent State repository (`<agentDir>/agent_state.git`), oldest first, dated with its original `savedAt`. The folder's own current files are recorded by its first load that succeeds, like any edit. History and Restore show the versions and times they showed before the upgrade.
- That id's `<agentDir>/workbenches-history/<id>/` then moves to `<agentDir>/.workbench-migration/backup/workbenches-history/<id>/`, where it stays: no code deletes it.
- Once the old directory is empty, it is replaced by a directory link to `agent_state/workbenches`: a junction on Windows, which needs no administrator rights, and a relative symlink elsewhere. From then on, whatever an Agent writes to the old place from its old Skill text lands in Agent State directly, edits to workbenches already moved included.

On the upgrade's first access every folder has long settled, so everything moves at once and the link appears. Folders the Workflow conversion has just written in the same access count as settled. The fallback is the same move, delayed, while the old place stays a real directory: an id that is taken stays where it is, logged once per server process with the `[workbenches]` prefix; a folder that has not settled waits for a later access; and a link that cannot be created is logged once, leaving the directory real. Nothing is overwritten or merged, and listing and loading carry on.

A version that cannot be read or committed is logged with the `[workbenches]` prefix and left out of the history, with its copy kept; the folder moves regardless. A run cut short is finished by a later access and commits no version twice. While the link stands, its target is kept in existence: an Agent State import that swaps in a State without workbenches gets the folder back on the next access. Deleting the Agent removes the link itself, never the workbenches through it. The Workflow conversion, which shares `.workbench-migration/`, now clears only its own staging when it starts over, so this backup survives it.

### Scope

Every Agent directory with `workbenches/` beside its `agent_state/`, on every server, machines included. `workbenches-history/` copies are read only for the ids that move.

### What you need to do

Nothing. A folder left in the old place because its id is taken is named in the server log; rename it or move it aside, and a later access adopts it. Accepting the `agent-development` plugin update on the Agents page brings an Agent's `penguin-plugin` Skill to the new location; until then the link carries its writes.

### Lifetime

The Workbench maintainers keep this code and the link until the next major version (1.0), and remove them in that release's preparation: `packages/server/src/workbenches/migrate-state.ts`, its call in `migrateWorkbenches` (`migrate.ts`) and `test/workbench-state-migration.test.ts`, and, with the Workflow conversion already gone at 0.3, `migrateWorkbenches` itself with every await of it (`workbenches/service.ts`, `services/agent-service.ts`, `http/routes/plugins.ts`, `http/routes/agent-transfer.ts`). None of this goes with the Workflow conversion at 0.3. The links already on disk outlive the code: each keeps leading to `agent_state/workbenches` and is safe to delete; whether 1.0 removes them is decided with that release. The backup is never removed by code.

## Compatibility

No action is required on upgrade. After a downgrade, an older build reads and writes the workbenches through the link where it expects them. The versions it records go to a `workbenches-history/` of its own, which a later upgrade does not import.
