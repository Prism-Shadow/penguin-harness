# Ctrl+P opens a command palette; its first command is the harness history

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `web`, `server`, `core`

[中文版](2026-08-30-command-palette.zh.md)

Ctrl+P or Ctrl+Shift+P (⌘P / ⌘⇧P on macOS) opens a VS Code-style command palette: an input that filters a list of commands, ↑↓ to select, Enter to run, Escape to close. The palette is the mechanism; commands register with it instead of claiming shortcuts of their own.

## Harness history

The one command today: an overlay over whatever you were doing — it fills the window short of a small margin, and Escape, the close button or a click on the margin returns you exactly where you were — listing the harness versions this server's data root has committed through hot updates, newest first — the pushing checkout's revision and repository when the pusher recorded them, the commit time, the content-addressed platform / cli / web bundles that identify the code itself, which version is currently committed — and **what each push changed**. The record is kept by the platform, not the runtime: the runtime only commits a version (`harness.json`); the platform that boots *is* that version, and at every boot it writes the commit record together with the interface table (`ifaces.json`) it was built from under `<root>/harness-history/` — its own directory beside the runtime's store — so the history is complete on any runtime old enough to boot the platform. The page diffs each version's table against the one before: nodes of the tree added, removed or rewired (requires, provides, contributes, children, exports), interfaces added, removed or changed member by member, and a count of data-type changes. `GET /api/version/history/ifaces/:hash` serves a stored table, `GET /api/version/history/diff?from=&to=` the diff.

`GET /api/version/history` serves the record (newest 100) with the runtime's current commit.

**Module tree.** Each version has a *Module tree* view beside its changes: the whole tree its recorded table describes — groups, modules and components under them, and for any node what it requires (and from which module), provides or exports, and contributes.

**Rollback.** The runtime's store keeps one rollback copy of each artifact; the platform keeps the whole last five versions under `<root>/harness-history/versions/` (bundles, web archive, native assets with their exec bits). Any kept version has a *Roll back to this version* button (admin; two clicks): the platform pushes the kept artifacts back through the runtime's own `/api/hmr/upgrade` with the local API token, answers before the swap, and the page polls the history until that version is current. `POST /api/version/history/rollback { id }`.
