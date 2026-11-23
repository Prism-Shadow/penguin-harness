# Manage terminal and browser resources by Session

- **Date:** 2026-11-23
- **Type:** feat
- **Scope:** server, browser automation

[中文版](2026-11-23-session-resource-management.zh.md)

The terminal and built-in browser APIs report live resources by Session within an accessible Project. Closing selected Sessions’ resources keeps other groups running. Terminal counts include the signed-in user’s shells. Browser counts include managed desktop pages. A subagent’s resources belong to its own Session, including when that Session is archived.
