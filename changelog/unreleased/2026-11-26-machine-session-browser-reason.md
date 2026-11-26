# A conversation on a machine says why it has no browser, instead of asking for the desktop app

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `browser-automation`, `server`, `web`

[中文版](2026-11-26-machine-session-browser-reason.zh.md)

Opening the browser in a conversation that runs on a remote machine no longer shows 「浏览器现在不可用：内置浏览器需要打开 PenguinHarness 桌面应用，你的 Chrome 需要连上 PenguinHarness Browser 扩展」 to someone who is already in the desktop app. A machine runs a plain `penguin server` with no desktop app. The panel used to ask that machine for its desktop pages and got this error every time. It now says the conversation runs on another machine, which has no desktop app, so conversations there cannot use the browser. It sends that machine no browser request.

## On the machine

- This server starts a machine's server with `PENGUIN_MACHINE=1`, so that server knows it runs as a machine.
- A machine pairs no Chrome of its own: an extension cannot reach a server bound to its loopback. It also offers no backend to switch to.
- An admin's browser request on a machine answers `503 browser_unavailable` with the new reason `hub_disconnected`. `penguin browser status` there says the session's browser is in PenguinHarness on the computer the machine was added from and cannot be reached from the machine now. It no longer asks the user to pair a Chrome. Import and clearing data answer `405 not_supported` there.
