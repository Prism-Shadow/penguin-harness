# Backward compatibility

- **Date:** 2026-09-16
- **Type:** process
- **Scope:** `server`

[中文版](2026-09-16-backward-compatibility.zh.md)

Sessions created before this change have no sandbox policy of their own. Migration 9, `sessions-sandbox`, adds a nullable `sandbox` column to the `sessions` table, and existing rows start with it empty.

An empty row takes the Sandbox settings in force at its next command and writes them to its row, and from then on it behaves like any other Session. Until that first command, the Session's permission button shows the current settings. Nothing to do by hand: the migration runs at the next start or the next push.

## 兼容性

The empty-row fallback is a few lines in the session environment's confiner and in `SessionService.sandboxOf`. It can go once every data root has run a command in each Session it still keeps, which no release can guarantee, so it stays until a later migration backfills the column outright. Whoever next touches the sessions table should decide whether to write that backfill and delete the fallback with it.
