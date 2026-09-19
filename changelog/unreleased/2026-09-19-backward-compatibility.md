# Activity candidate storage migration

- **Date:** 2026-09-19
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#3](https://github.com/nicolaepocroianu/penguin-harness/pull/3), [#9](https://github.com/nicolaepocroianu/penguin-harness/pull/9)

[中文版](2026-09-19-backward-compatibility.zh.md)

Migration 12 moved existing candidate text from activity run JSON into a separate payload table and retained compact history metadata, without resetting drafts or run history.

## Compatibility

Restart the server to apply this one-time migration. Hot replacement refuses it because older writers embedded candidates in the metadata row. Before running an older binary against the upgraded database, roll migration 12 back with the migration runner or restore a pre-upgrade backup. Its rollback restores inline candidate text, including invalid specification output.

Repository maintainers retain the conversion and rollback as migration history until the minimum supported database schema no longer permits version 11. Runtime readers use only the migrated format.

## Module assembly storage

Migration 13 added a separate module-run identity table without rewriting existing specification records. Restart the server before starting module assembly. Rollback refuses databases containing module attempts, because an older runtime would interpret those attempts as specification generation. Restore a pre-upgrade backup before downgrading such a database. Repository maintainers retain this migration until schema versions below 13 cease to be supported.
