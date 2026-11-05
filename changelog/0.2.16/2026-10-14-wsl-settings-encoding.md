# Readable WSL diagnostics in settings

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `sandbox-wsl`
- **PR:** [#1125](https://github.com/Prism-Shadow/penguin-harness/pull/1125)

[中文版](2026-10-14-wsl-settings-encoding.zh.md)

Fixed garbled Chinese WSL diagnostics in Settings → Plugins. WSL command output and installation logs were decoded as UTF-8 or UTF-16LE before displaying their text.
