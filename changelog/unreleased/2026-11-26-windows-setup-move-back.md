# Windows Setup keeps data-location history valid when moving back to a previous folder

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `desktop`

[中文版](2026-11-26-windows-setup-move-back.zh.md)

Fixed Windows Setup when moving the desktop data directory back to a cleared folder that had held it earlier. The location history written alongside the relocated copy dropped the newly active data directory from its list of previous roots instead of keeping a self-referential entry that kept PenguinHarness from starting afterward.

## Details

- Removed any prior entry matching the new data root (case-insensitively) before saving the updated relocation history, while preserving earlier source locations and keeping the serialized list as a JSON array even when a single entry remains.
- Extended the Windows data-location test script to cover moving back to a previously used folder with different letter casing and verifying a single-entry relocation history.
