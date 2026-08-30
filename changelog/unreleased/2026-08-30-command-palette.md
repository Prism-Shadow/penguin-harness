# Ctrl+P opens a command palette; its first command is the harness history

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`, `server`, `core`

[中文版](2026-08-30-command-palette.zh.md)

Ctrl+P (⌘P on macOS) opens a VS Code-style command palette: an input that filters a list of commands, ↑↓ to select, Enter to run, Escape to close. The palette is the mechanism; commands register with it instead of claiming shortcuts of their own.

## Harness history

The one command today. It lists the harness versions this server's data root has committed through hot updates, newest first: the pushing checkout's revision and repository when the pusher recorded them, the commit time, the content-addressed platform / cli / web bundles that identify the code itself, and which version is currently committed.

The record behind it is `<root>/hmr/history.json`: every version the store commits is appended (the newest 100 are kept), separately from the bundles themselves — the store keeps only a rollback copy of each artifact, so the history is what remembers what was pushed. `GET /api/version/history` serves it with the current commit.
