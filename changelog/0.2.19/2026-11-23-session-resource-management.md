# Manage terminal and browser resources by Session

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `server`, `browser-automation`
- **PR:** [#1737](https://github.com/Prism-Shadow/penguin-harness/pull/1737)

[中文版](2026-11-23-session-resource-management.zh.md)

The terminal and built-in browser APIs report live resources by Session within an accessible Project. Closing selected Sessions’ resources keeps other groups running. Terminal counts include the signed-in user’s shells. Browser counts include managed desktop pages. A subagent’s resources belong to its own Session, including when that Session is archived.
