# Compatibility with existing installations

- **Date:** 2026-11-23
- **Type:** change
- **Scope:** `first-workbench-guide`, `web`, `desktop`

[中文版](2026-11-23-backward-compatibility.zh.md)

## Windows desktop upgrades

A legacy installer may have registered a custom program folder for recursive removal. Setup recognizes the stock Windows 0.2.18 file inventory and a folder matching the packaged program. If it cannot identify the contents, setup leaves the entire folder in place. Close PenguinHarness, rename the old folder to keep a backup and run setup again to choose an empty program folder.

New installers register their own inventory-based removal capability. The legacy check can be retired when upgrades from installers with recursive removal are no longer supported.

## Earlier first-workbench guides

The guide opens existing links and reads the same account- and workbench-scoped progress in the same browser tab. Saved replies, edits and installed checklists are available without conversion. An earlier guide installed on an agent can finish its existing checklist. To generate from a new chat, use **Update guide on this agent** and review the confirmation. It replaces the guide code and preserves its data. The old entry and capability check can be removed when support for these installed guide versions ends.
