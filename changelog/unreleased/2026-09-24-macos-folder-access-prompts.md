# macOS asks for Desktop, Documents and Downloads in the app's own name

- **Date:** 2026-09-24
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`, `docs`
- **PR:** [#846](https://github.com/Prism-Shadow/penguin-harness/pull/846)

[中文版](2026-09-24-macos-folder-access-prompts.zh.md)

On macOS, a Workspace chosen under Downloads (or Desktop, Documents, an external or network volume)
looked empty to every agent, and no permission prompt ever appeared, so PenguinHarness was not
listed under Files and Folders and there was nothing to allow. The Workspace picker named the
setting and offered a Retry that could not change anything.

The app now carries a purpose string for each of those locations, and asks for them itself. The
picker's box for a refused folder offers **Allow access**: the desktop app's main process reads the
folder once in the app's own name, which is the read macOS answers with its prompt. Once it is
allowed, the listing reloads, and the app's server and every agent shell it starts can read the
folder too. If macOS still refuses, the box says what to change and **Open System Settings** goes
straight to Privacy & Security: Full Disk Access for the packaged app, which can be added there by
hand when it is not listed under Files and Folders. A development instance started from a terminal
is told that macOS charges its reads to that terminal, and is sent to Files and Folders to allow
the terminal. A browser tab has no app to ask, so its box says which process to allow and keeps
Retry.

## Details

- `POST /api/projects/:projectId/dirs/access` (`{path}` → `{granted, packaged}`) has the desktop
  shell read one folder in the app's own name, and waits for the user's answer to macOS. It
  returns `503` `shell_unreachable` when the server has no desktop shell to ask, and `504`
  `timeout` after 120 seconds without an answer.
- `POST /api/desktop/privacy-settings` (`{pane}`, `files` or `fullDisk`) has the shell open that
  Privacy & Security pane. Like the other page-facing desktop routes, it answers only the shell's
  own window.
- The shell and the server exchange three new frames over the utilityProcess port:
  `desktop-folder-access`, its reply `desktop-folder-access-result`, and
  `desktop-open-privacy-settings`. Off macOS the shell reads and opens nothing.
- The Web App localizes the `shell_unreachable` and `timeout` error codes.
