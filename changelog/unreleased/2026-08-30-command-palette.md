# Ctrl+P opens a command palette; its first command is the harness history

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`, `server`, `core`

[中文版](2026-08-30-command-palette.zh.md)

Ctrl+P (⌘P on macOS) opens a VS Code-style command palette: an input that filters a list of commands, ↑↓ to select, Enter to run, Escape to close. The palette is the mechanism; commands register with it instead of claiming shortcuts of their own.

## Harness history

The one command today: a full page (`/harness/history`) of the harness versions this server's data root has committed through hot updates, newest first — the pushing checkout's revision and repository when the pusher recorded them, the commit time, the content-addressed platform / cli / web bundles that identify the code itself, which version is currently committed — and **what each push changed**: the interface table (`ifaces.json`) the platform was built from travels with the push, is stored by its own sha256 (`store/ifaces/<hash>.json`), and the page diffs it against the version before: nodes of the tree added, removed or rewired (requires, provides, contributes, children, exports), interfaces added, removed or changed member by member, and a count of data-type changes. `GET /api/version/history/ifaces/:hash` serves a stored table, `GET /api/version/history/diff?from=&to=` the diff.

The record behind it is `<root>/hmr/history.json`: every version the store commits is appended (the newest 100 are kept), separately from the bundles themselves — the store keeps only a rollback copy of each artifact, so the history is what remembers what was pushed. `GET /api/version/history` serves it with the current commit.
