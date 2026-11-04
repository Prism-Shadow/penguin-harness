# The penguin-plugin Skill and the docs follow workbenches into Agent State

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `skills`, `plugins`, `docs`
- **PR:** [#1446](https://github.com/Prism-Shadow/penguin-harness/pull/1446)

[中文版](2026-11-03-workbench-guidance-follows-agent-state.zh.md)

The `penguin-plugin` Skill, the plugin READMEs and the docs stopped pointing at `<agentDir>/workbenches/` and `workbenches-history/`. They named `agent_state/workbenches/<id>/` as where an agent's workbenches live, `agent_state.git/` beside it as where their versions are recorded, and the zip import and export of the Workbenches tab. See [workbenches live in Agent State](2026-11-03-workbenches-live-in-agent-state.md), [workbench versions are git commits](2026-11-03-workbench-versions-are-git-commits.md) and [workbench import and export](2026-11-03-workbench-import-export.md).

## Details

- `penguin-plugin`: the description, the build steps and Layout named `<App Data Dir>/agents/<agent_id>/agent_state/workbenches/<workbench_id>/`. Layout gained a paragraph on `<App Data Dir>/agents/<agent_id>/agent_state.git/`, the bare repository beside the Agent State: what the server commits and never commits, that it must never be deleted, rewritten or committed to, and that git use there is read-only (`log`, `show`, and a path-limited `checkout` that writes one version back).
- `penguin-plugin` HTTP: history entries became `{ revision, commit, savedAt }`, a restore is recorded as the newest version, a delete records the removal so earlier versions are no longer listed, and `POST /archive` and `GET /:id/archive` were added with what an import refuses.
- `penguin-plugin` "Undoing, reverting, removing": `workbenches-history/` was dropped. Removing deletes the workbench's folder alone and leaves `agent_state.git` in place; a folder deleted by hand keeps its listed history for a workbench made again under that id, while *Remove* and `DELETE /:id` cut it. Undoing asks the user for *History → Restore*, or uses `POST /:id/rollback`, or, with git installed, `git --git-dir=…/agent_state.git log --oneline -- workbenches/<id>`, `show <commit>:workbenches/<id>/<file>` and `--work-tree=…/agent_state checkout <commit> -- workbenches/<id>`, which leaves files added since that version in place.
- The Skill's `version` became `2026.11.03.1`, so installed copies are offered the update.
- `plugins/penguin-support/README.md` and `plugins/README.md` named the install location and where the version history lives.
- Docs, in English and Chinese: Skills & Plugins › Workbench plugins named the install location and described versions as commits in `agent_state.git/`, which snapshots, exports and imports of the Agent State never carry or touch. Agents gained a Workbenches tab section and table row (History and Restore, Export, Import zip with what it refuses and its overwrite confirmation, Remove and how it differs from deleting the folder by hand) and listed workbenches in the Agent State. Agents and Self-Improvement named the pre-import backup, its own `snapshots/import-backup-v<version>-<time>-<random>.tar.gz` file rather than a `v<version>.tar.gz` snapshot. The Sessions & Traces data layout gained `agent_state/workbenches/` and `agent_state.git/`; Concepts and Self-Improvement followed.
