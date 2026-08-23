# The desktop shell reloads a crashed page on a budget

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#412](https://github.com/Prism-Shadow/penguin-harness/pull/412)

[中文版](2026-08-23-desktop-renderer-reload-budget.zh.md)

A gone render process leaves the app window empty, so the shell reloads it. That reload was
unconditional and unbounded: a page that crashes on every load reloaded forever at full
speed, and a crash reported while the window was already tearing down reloaded a destroyed
`webContents`. The reload now skips a clean exit and a quit in progress, and gets three
attempts before the crashed page is left in place, with the View menu's Reload as the way
back.

## Details

- The budget resets once a load has stayed up for a minute — the same shape as the embedded
  server's restart budget, so a crash days later starts from a full count instead of an
  exhausted one.
- `clean-exit` is excluded: that reason is the render process going away on purpose.
- Each attempt and the exhausted budget print a `[shell]` line naming the reason.
