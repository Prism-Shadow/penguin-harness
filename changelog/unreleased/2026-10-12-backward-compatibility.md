# Backward compatibility: a `server.lock` without a version

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `core`, `server`

[中文版](2026-10-12-backward-compatibility.zh.md)

[A data root's one-time Project-config migration is not written back while an older server holds the root](2026-10-12-dev-cli-data-root.md), and servers started recording their version in `<root>/server.lock` for it. Every server from before that writes a lock with only `pid`, `port` and `startedAt`, so an installed release can hold a data root with such a lock while newer code reads the same root.

## The old shape: a lock with no `version`

A live lock without `version` reads as a server older than any version. While one holds a data root, the migration of a `.project_config.toml` there is used in memory and the file is not rewritten. The readers of the lock stay lenient: a lock without the field is still a valid lock for the CLI's attach, the desktop shell's attach mode and the server's single-instance check. A lock that is not live, because its process or its port is gone, does not block the write.

## What users need to do

Nothing. Once the older server has been upgraded or stopped, the next read writes the migrated file.

## When it can be removed

At the 0.3.0 release preparation, by whoever prepares it, together with `migrateLegacyClientTypes` (see [backward compatibility](2026-10-01-backward-compatibility.md)), once no server from before the version field can still be running against a data root. The removal takes out:

- the branch of `predates` in `packages/core/src/state/migration-write-back.ts` that counts a lock without a version as older;
- the "counts a live server whose lock records no version as older" scenario in `packages/core/test/migration-write-back.test.ts`.

The write-back rule itself goes when no one-time migration calls it any more.
