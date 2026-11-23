# Existing Windows data directories

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** desktop, core, cli, server
- **PR:** https://github.com/Prism-Shadow/penguin-harness/pull/1759

[中文版](2026-11-23-backward-compatibility.zh.md)

An upgrade keeps the existing server library and Electron profile in their current folders. Selecting a different data directory copies both, verifies their files and then records the location for this Windows user. A cancelled or failed move leaves the active location in place. Quit the desktop app and its server before moving. Explicit root options and environment overrides continue to apply.

Setup and uninstall retain the previous files. After checking the relocated library and profile, only the user decides when to remove the original copies. The installer continues to recognize the standard locations for existing installations.

Existing Sessions with a Workspace inside the original server data directory resume and edit the corresponding copy on the new drive. Their original Trace retains the recorded path. Workspaces outside the data directory keep their location. Keep the location history that Setup writes next to the copy for as long as Sessions refer to a previous location.
