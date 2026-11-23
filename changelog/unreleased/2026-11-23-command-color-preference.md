# Commands inherit the terminal color preference

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `core`

[中文版](2026-11-23-command-color-preference.zh.md)

Commands started by an Agent inherit `NO_COLOR` only when the user has set it.
