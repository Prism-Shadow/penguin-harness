# Relocate hidden files during Windows data setup

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `desktop`

[中文版](2026-11-23-windows-setup-hidden-files.zh.md)

Windows Setup now verifies and copies hidden files (including hidden system files such as `desktop.ini` and hidden configuration files) when moving server data or the desktop profile to another directory, instead of aborting with a missing-file error.

## Details

- Preserved file contents, Windows hidden/system/read-only attributes, and named data streams on hidden files across initial and repeated data relocations.
