# Compatibility with existing installations

- **Date:** 2026-11-23
- **Type:** change
- **Scope:** `desktop`

[中文版](2026-11-23-backward-compatibility.zh.md)

## Windows desktop upgrades

A legacy installer may have registered a custom program folder for recursive removal. Setup recognizes the stock Windows 0.2.18 file inventory and a folder matching the packaged program. If it cannot identify the contents, setup leaves the entire folder in place. Close PenguinHarness, rename the old folder to keep a backup and run setup again to choose an empty program folder.

New installers register their own inventory-based removal capability. The legacy check can be retired when upgrades from installers with recursive removal are no longer supported.
