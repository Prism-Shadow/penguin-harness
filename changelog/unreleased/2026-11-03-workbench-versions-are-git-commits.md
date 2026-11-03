# Workbench versions are git commits

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-11-03-workbench-versions-are-git-commits.zh.md)

Workbench versions moved from full folder copies under `<agentDir>/workbenches-history/` into a git repository over the Agent State, `agent_state/.git`, which the server writes with the bundled isomorphic-git (no system git needed). A workbench's versions became the commits that touched `workbenches/<id>/`, and its revision became that folder's git tree id. Versions recorded before the change are carried over by the one-time migration; see [backward compatibility](2026-11-03-backward-compatibility.md).

## Details

- Recording: each successful load commits the workbench's source as `workbenches/<id>/` on top of HEAD, subject `workbench <id> @<revision>`, author `PenguinHarness <penguin@localhost>`; a load of unchanged files commits nothing. The first commit creates the repository on branch `main` and `agent_state/.gitignore` (written only when missing). The server writes git objects and the branch ref directly, never through the index or the working tree, and then updates the index so that `git status` in `agent_state/` reads clean for the workbench folders.
- Never committed: `.vault.toml`, `state.json`, `.build/`, `.harness/`, `.plugin.json`, `node_modules/`, staged temporary files and symbolic links; every file is committed as mode `100644`. Skills, hooks, `AGENTS.md`, `system_config.yaml` and `memory/` are not committed.
- Revision: `WorkbenchInfo.revision` became the first 12 hex digits of the folder's git tree id (what `git rev-parse HEAD:workbenches/<id>` prints), and `uiRev` that of its `ui/`. `.build/<revision>/` and `status.json` follow the new value; the next load prunes builds named by the old hash.
- History: `GET …/workbenches/:id/history` lists at most 50 versions found within the newest 2,000 first-parent commits, newest first, each `{ revision, commit, savedAt }`. `name`, `version`, `uiRev` and `files` were dropped, and the Web App's history list stopped showing a version's package version and file count. The 20-version cap and its trimming were removed.
- Rollback: `POST …/:id/rollback` takes a listed revision (404 otherwise), makes the folder's source exactly that tree, leaving `state.json` and the dot entries as they are, and reloads, which records the restore as the newest version. A recorded tree that holds anything other than source is refused.
- Delete: `DELETE …/:id` removes the folder with its state and commits the removal (`workbench <id>: removed`). The earlier commits stay in the object store but are no longer listed; a workbench made again under the same id starts a new history.
- Failures: a repository that cannot be written is logged as `version not recorded` and never fails a load; a history that cannot be read answers 500 `workbench_history_unreadable`, which the pages offer to retry. A detached HEAD records no versions.
- Snapshots: Agent State snapshots and exports leave out `agent_state/.git` and each workbench's `.build/` and `node_modules/`. An import keeps the Agent's current repository the way it keeps the vault, drops any `.git` a package carries, and first releases the Agent's workbenches, whose watcher sits inside `agent_state/`.
- Writes to one Agent's repository run one at a time. isomorphic-git does not pack, so objects stay loose; deleting `agent_state/.git` wipes the history.
- `isomorphic-git` `^1.44.0` became a dependency of `@prismshadow/penguin-server`.
