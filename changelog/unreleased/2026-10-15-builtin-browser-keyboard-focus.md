# Typing in the built-in browser no longer lands in the app

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `desktop`, `server`, `skills`, `docs`
- **PR:** [#1150](https://github.com/Prism-Shadow/penguin-harness/pull/1150)

[中文版](2026-10-15-builtin-browser-keyboard-focus.zh.md)

`penguin browser type` in the built-in browser typed into whatever held the app window's
keyboard focus instead of the page. With the composer focused, the text and the Enter were sent
as a message to the running conversation. With the Browser panel's address bar focused, the
tab searched for the text. The command still reported success.

## Details

- Before relaying a keyboard command (`Input.insertText`, `Input.dispatchKeyEvent`,
  `Input.imeSetComposition`), the desktop app now focuses that tab's page element in the app
  window. Keyboard focus moves into the page, the same as when an agent clicks. The window is
  not brought to the front, and a tab parked off-screen does not scroll.
- When a tab cannot take keyboard focus, nothing is typed anywhere. `type` reports a failed
  result, and a raw `penguin browser cdp` keyboard command answers 409 `keyboard_focus_failed`.
- The fix is in the desktop app's main process, so it arrives with a desktop app update, not
  with a server push.
- The CLI reference, the built-in browser guide and the `browser-automation` Skill describe the
  new behavior and the new error code.
- The built-in browser smoke script checks under Electron that typing reaches the page while the
  app's composer is focused.
