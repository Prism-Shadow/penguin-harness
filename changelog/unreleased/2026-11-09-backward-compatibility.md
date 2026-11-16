# Backward compatibility in this batch

- **Date:** 2026-11-09
- **Type:** process
- **Scope:** `server`, `cli`, `web`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[中文版](2026-11-09-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Agent snapshot packages exported before the zip

[An Agent travels as a zip of its directory](2026-11-09-agent-zip-export-import.md). Before this batch an export was a `.tar.gz` rooted at `agent_state/`. `POST …/agents/import`, `penguin agent import` and the Web App's **Import agent** still take one: the server tells it from a zip by its gzip magic bytes, and only the unpack step differs. Such a package names no Agent, so it needs `agentId` in the query (`--agent-id`). It carries no Traces.

### Scope

Every `.tar.gz` snapshot package exported by an earlier release, imported on any server.

### What you need to do

Nothing.

### Lifetime

The server maintainers keep the tar.gz branch of the unpack in `packages/server/src/services/snapshot-service.ts` until the next major version (1.0), and remove it in that release's preparation, together with the `.tar.gz` mentions in `penguin agent import`'s help and docs and the `.tar.gz` entries of the Web App's import file picker (`ARCHIVE_ACCEPT` in `packages/web/src/features/agents/archive-file.ts`) and its hint. Overwrite backups stay `.tar.gz`; they are not import packages.
