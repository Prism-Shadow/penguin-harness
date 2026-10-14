# Workbench controls and support questions

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `web`, `core`, `plugins`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[中文版](2026-10-14-workbench-controls.zh.md)

Added a floating exit button to Workbenches shown as the whole app. Reloading a Workbench no longer restarts the development server: the dev launcher excludes the resolved data directory from `tsx watch`, while Workbenches retain their own source watcher. Restart the dev command to apply this change. Failed history requests show an error and a retry button. Concurrent first reads share one load of a revision.

## Plugin files

The plugin browser now includes Workbench manifests, handlers and nested UI files. All shipped plugins received English and Chinese display titles. Installing a plugin update refreshes the generated host types alongside its source, while preserving questions and version history.

## Support questions

New support questions require only the question text. Their titles follow the associated Session, including later title changes. Running questions show elapsed time and an approximate two-minute countdown; a longer run is marked as taking longer than estimated. Empty proxy responses show a readable service error and keep the question draft.
