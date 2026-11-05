# Reliable workbench discovery and server tests

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `ui-gallery`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[简体中文](2026-10-14-server-test-stability.zh.md)

Server tests run with at most two workers. Workbench compilation scenarios run independently. The streaming test releases its producer after receiving the first chunk. Coverage reports remain available when a test fails.

Skill archive tests check declared size limits with small ZIP fixtures, avoiding duplicate compression of multi-megabyte payloads.

An Agent's first workbench is discovered even when the filesystem misses its directory-creation notification. The server checks for the missing directory until it appears, then switches to its normal file watcher.

The component gallery serves the Agent plugin listing through its mock API.
