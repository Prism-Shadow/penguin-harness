# The penguin-plugin Skill and the docs follow workbenches into Agent State

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `skills`, `plugins`, `docs`

[中文版](2026-11-03-workbench-guidance-follows-agent-state.zh.md)

The `penguin-plugin` Skill, the plugin READMEs and the docs stopped pointing at `<agentDir>/workbenches/` and `workbenches-history/`. They named `agent_state/workbenches/<id>/` as where an agent's workbenches live, `agent_state/.git` as where their versions are recorded, and the zip import and export of the Workbenches tab. See [workbenches live in Agent State](2026-11-03-workbenches-live-in-agent-state.md), [workbench versions are git commits](2026-11-03-workbench-versions-are-git-commits.md) and [workbench import and export](2026-11-03-workbench-import-export.md).

## Details

- `penguin-plugin`: the description, the build steps and Layout named `<App Data Dir>/agents/<agent_id>/agent_state/workbenches/<workbench_id>/`. Layout gained a paragraph on `agent_state/.git`: what the server commits and never commits, that git may be used there only to read and to write one workbench's folder back, and that the repository must never be deleted or rewritten and `git clean` never run in `agent_state/`, which would delete the untracked rest of the Agent State, and with `-x` also `state.json` and `.vault.toml`.
- `penguin-plugin` HTTP: history entries became `{ revision, commit, savedAt }`, a restore is recorded as the newest version, a delete records the removal so earlier versions are no longer listed, and `POST /archive` and `GET /:id/archive` were added.
- `penguin-plugin` "Undoing, reverting, removing": `workbenches-history/` was dropped. Removing deletes the workbench's folder alone and leaves `agent_state/.git` in place. Undoing asks the user for *History → Restore*, or uses `POST /:id/rollback`, or, with git installed, `git log --oneline -- workbenches/<id>` and `git checkout <commit> -- workbenches/<id>`, which leaves files added since that version in place.
- The Skill's `version` became `2026.11.03.1`, so installed copies are offered the update.
- `plugins/penguin-support/README.md` and `plugins/README.md` named the install location and where the version history lives.
- Docs, in English and Chinese: Skills & Plugins › Workbench plugins named the install location and described versions as commits in `agent_state/.git`. Agents gained a Workbenches tab section and table row (History and Restore, Export, Import zip with its overwrite confirmation, Remove), listed workbenches in the Agent State, and stated that a snapshot import keeps the current workbench version history; Concepts and Self-Improvement followed.
