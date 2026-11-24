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

## Existing Windows data directories

An upgrade keeps the existing server library and Electron profile in their current folders. Selecting a different data directory copies both, verifies their files and then records the location for this Windows user. A cancelled or failed move leaves the active location in place. Quit the desktop app and its server before moving. Explicit root options and environment overrides continue to apply.

Setup and uninstall retain the previous files. After checking the relocated library and profile, only the user decides when to remove the original copies. The installer continues to recognize the standard locations for existing installations.

Existing Sessions with a Workspace inside the original server data directory resume and edit the corresponding copy on the new drive. Their original Trace retains the recorded path. Workspaces outside the data directory keep their location. Keep the location history that Setup writes next to the copy for as long as Sessions refer to a previous location.
