# Ctrl+P opens a command palette; its first command is the harness history

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`, `server`, `core`

[中文版](2026-08-30-command-palette.zh.md)

Ctrl+P (⌘P on macOS) opens a VS Code-style command palette: an input that filters a list of commands, ↑↓ to select, Enter to run, Escape to close. The palette is the mechanism; commands register with it instead of claiming shortcuts of their own.

## Harness history

The one command today: a full page (`/harness/history`) of the harness versions this server's data root has committed through hot updates, newest first — the pushing checkout's revision and repository when the pusher recorded them, the commit time, the content-addressed platform / cli / web bundles that identify the code itself, which version is currently committed — and **what each push changed**. The record is kept by the platform, not the runtime: the runtime only commits a version (`harness.json`); the platform that boots *is* that version, and at every boot it writes the commit record together with the interface table (`ifaces.json`) it was built from under `<root>/harness-history/` — its own directory beside the runtime's store — so the history is complete on any runtime old enough to boot the platform. The page diffs each version's table against the one before: nodes of the tree added, removed or rewired (requires, provides, contributes, children, exports), interfaces added, removed or changed member by member, and a count of data-type changes. `GET /api/version/history/ifaces/:hash` serves a stored table, `GET /api/version/history/diff?from=&to=` the diff.

`GET /api/version/history` serves the record (newest 100) with the runtime's current commit.
