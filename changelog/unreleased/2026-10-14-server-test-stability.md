# More reliable server tests

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server` tests
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[简体中文](2026-10-14-server-test-stability.zh.md)

Server tests run with at most two workers. Workbench compilation scenarios run independently. The streaming test releases its producer after receiving the first chunk. Coverage reports remain available when a test fails.

Skill archive tests check declared size limits with small ZIP fixtures, avoiding duplicate compression of multi-megabyte payloads.
