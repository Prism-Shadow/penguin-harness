# The desktop app keeps a log file of what its processes do

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `desktop`
- **PR:** [#848](https://github.com/Prism-Shadow/penguin-harness/pull/848)

[中文版](2026-09-29-desktop-log.zh.md)

The desktop app writes the lines its shell prints and the embedded server's output to `desktop.log`, each stamped with the time, and logs every process that goes away, so a crash or a restart leaves a trace a user can send.

## Details

- The file is `logs/desktop.log` in the app's user data directory: `~/Library/Application Support/PenguinHarness/` on macOS, `%APPDATA%\PenguinHarness\` on Windows and `~/.config/PenguinHarness/` on Linux. At 5 MB it is renamed to `desktop.log.1`, replacing the previous one, and a new file begins. Lines are written synchronously, so the last ones before a crash are on disk.
- A renderer that goes away is logged with its kind and id, its page's origin and path, and Electron's reason and exit code: the window's page, a built-in browser tab, DevTools. So is any other child process that goes away (the GPU process, the embedded server, utility processes), and the server's exit code on every exit. A window or a tab that stops responding is logged too.
- The window's page still reloads after its renderer dies, but after a pause that grows while it keeps dying: at once, then 1, 2, 4 and up to 30 seconds. A page that stays up for a minute starts the count over.
