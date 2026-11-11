# Backward compatibility in this batch

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)

[中文版](2026-11-04-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Memory export files written before memories kept scripts

[A memory keeps the agent's reusable scripts](2026-11-04-memory-scripts.md) moved the memory export document to `version: 2`, in which a topic may carry the files its folder keeps. A file exported before carries `version: 1` and topic files only. Users keep such files as backups and carry them between servers.

Left alone, the new server would have refused every such file as an unknown version.

Chosen (owner's decision, penguin-harness-design [#423](https://github.com/Prism-Shadow/penguin-harness-design/pull/423)): **read both versions.** The import route and the Memory tab's file picker accept a `version: 1` document, which names each topic file by `name` exactly as version 2 does and brings no files. No file on disk is rewritten, and an export always writes version 2. The other direction is not bridged: a server from before this change refuses a version 2 file.

### Scope

The memory import route (`POST …/memory/scopes/:key/import`) and the Memory tab's **Import**, on every server, machines included.

### What you need to do

Nothing. A file exported before imports as it did. To move memory to an older server, update that server first.

### Lifetime

The Memory maintainers keep the version 1 reader until the next major version (1.0) and remove it in that release's preparation: `SCOPE_FORMAT_VERSION_TOPICS_ONLY` and its branch in `parseTransferDocument` (`packages/server/src/services/memory-transfer-document.ts`), `MemoryScopeExportV1` in `packages/server/src/api/types.ts`, the version 1 branch of `parseMemoryScopeDocument` (`packages/web/src/features/agents/memory-transfer.ts`), and the tests that read a version 1 document. From then on a version 1 file is refused as an unknown version.
