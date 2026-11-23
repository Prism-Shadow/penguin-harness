# Enforce terminal and built-in browser limits when opening resources

- **Date:** 2026-11-23
- **Type:** feat
- **Scope:** server, browser automation

[中文版](2026-11-23-enforce-session-resource-limits.zh.md)

Concurrent terminal starts share each user’s limit. The built-in browser reserves a page slot before its desktop window opens the tab and applies the same limit to popups. Reducing a limit keeps existing resources running. Closing resources below the limit makes room for new ones.
