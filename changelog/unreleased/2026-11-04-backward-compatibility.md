# Backward compatibility in this batch

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`, `web`, `cli`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-04-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## `.tar.gz` Agent State packages written before the zip export

[Agents now export to a zip](2026-11-04-agent-zip-export-import.md). Before this batch the settings page exported an Agent State as `<agentId>-v<N>.tar.gz` (`agent_state/` without the vault), and such files exist on users' disks.

Chosen (owner's decision): **an old package keeps importing until 1.0.**

- What is tolerated: an old `.tar.gz` package imports through the zip import, sniffed by its gzip header, in the Web App's import dialog, in the settings page's replace-from-file, and through `penguin agent import`. With a free id it creates a new Agent from the package; with `overwrite=1` it replaces an existing Agent's State. It needs an `agentId`, since the package names no Agent. It is extracted under the snapshot import's rules (no vault, no `.git` path, links only inside `agent_state/`), and its contents are not held to the zip's Skill and hook checks. The file pickers keep accepting `.tar.gz`, `.tgz` and `.gz`.
- Scope: every install.
- The user does nothing.
- Removal: with the 1.0 release. Whoever prepares 1.0 deletes `packages/server/src/agent-archive/tar-compat.ts`, its two `tar.gz` branches in `agent-archive/import.ts`, the `.tar.gz` entries in the Web App's and the CLI's file pickers, and `packages/server/test/agent-archive-compat.test.ts`.

The internal version snapshots (`snapshots/v<N>.tar.gz`, which the optimizer and RSI Skills write and read) and the import backups (`snapshots/import-backup-*.tar.gz`) are not this format's concern and do not change.

## Removed routes

Not tolerated, by the owner's decision: `GET /api/projects/:p/agents/:a/export`, `POST /api/projects/:p/agents/:a/import` and the `dataBase64` seed of `POST /api/projects/:p/agents` were removed in this batch with no alias. An API client that called them gets a 404 (the create route ignores the field). The `penguin` CLI never called them, and the Web App changes in the same release.
