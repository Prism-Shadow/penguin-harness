# The sandbox's unconfined file mode is named Full access

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1021](https://github.com/Prism-Shadow/penguin-harness/pull/1021)

[中文版](2026-10-10-sandbox-full-access-label.zh.md)

The sandbox settings' file-write option that confines nothing was renamed from "Off (full access)" to **Full access** (「完全访问」, previously 「关闭（完全访问）」), matching the name the permission menu and the presets already use. The setting's description and the no-backend notice name it the same way. Stored settings are unchanged; only the label moved.
