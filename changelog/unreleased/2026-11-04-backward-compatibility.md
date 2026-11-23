# Backward compatibility in this batch

- **Date:** 2026-11-04
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1487](https://github.com/Prism-Shadow/penguin-harness/pull/1487)

[中文版](2026-11-04-backward-compatibility.zh.md)

Every compatibility decision of this batch is recorded here once; the feature entries reference this file instead of re-telling it.

## Memory export files written before the zip

[A memory keeps the agent's reusable scripts](2026-11-04-memory-scripts.md) made the memory export a zip of the scope folder. Up to this change, and since 0.2.4, the export was a JSON document (`format: "penguin-memory-scope"`, `version: 1`) holding the topic files and `MEMORY.md`. Users keep such files as backups and carry them between servers.

Left alone, the new server would have refused every such file.

Chosen (owner's decision, penguin-harness-design [#423](https://github.com/Prism-Shadow/penguin-harness-design/pull/423), kept when the export became a zip): **read both.** The import route takes the zip as `dataBase64` and still takes the JSON document as `payload`, with the checks it always had; the Memory tab's file picker sends either. Such a document brings topic files only. No file on disk is rewritten, and an export always writes the zip. The other direction is not bridged: a server from before this change refuses a zip.

### Scope

The memory import route (`POST …/memory/scopes/:key/import`) and the Memory tab's **Import**, on every server, machines included.

### What you need to do

Nothing. A file exported before imports as it did. To move memory to an older server, update that server first.

### Lifetime

The Memory maintainers keep the JSON reader until the next major version (1.0) and remove it in that release's preparation: `packages/server/src/services/memory-transfer-document.ts`, the import route's `payload` branch (`packages/server/src/http/routes/memory.ts`), `MemoryScopeExport` and `MemoryTransferFile` in `packages/server/src/api/types.ts`, the JSON branch of `memoryUploadOf` (`packages/web/src/features/agents/memory-transfer.ts`), and the tests that read a version 1 document. From then on a JSON file is refused like any other upload that is not a zip.
