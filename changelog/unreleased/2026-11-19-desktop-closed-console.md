# Desktop logging after the launcher closes

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1612](https://github.com/Prism-Shadow/penguin-harness/pull/1612)
- **Issue:** [#1604](https://github.com/Prism-Shadow/penguin-harness/issues/1604)

[中文版](2026-11-19-desktop-closed-console.zh.md)

On Linux, the desktop app keeps running when its launcher stops reading console output. Shell and server messages continue to appear in `logs/desktop.log` under the app’s data directory.
