# Workspace picker: "Use this dir" takes the path you typed

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#871](https://github.com/Prism-Shadow/penguin-harness/pull/871)

[中文版](2026-09-28-workspace-picker-typed-path.zh.md)

Typing a path into the workspace picker and clicking **Use this dir** without pressing Enter now uses the typed path. Before, the button took the directory listed before the edit — the server's home directory on a fresh picker — with nothing on screen saying so, and a new Session was created there.

## Details

- A typed path that differs from the listed directory is checked on the server first; the picker closes on the directory it resolved to.
- A typed path that does not exist, or cannot be read, shows the existing "Directory does not exist or is inaccessible" notice, reverts the box, and commits nothing; the picker stays open.
- The button is also enabled when the first listing failed but a path has been typed.
