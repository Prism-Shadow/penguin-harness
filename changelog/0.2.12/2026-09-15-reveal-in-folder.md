# Show in folder, from the desktop app's own window

- **Date:** 2026-09-15
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#733](https://github.com/Prism-Shadow/penguin-harness/pull/733)

[中文版](2026-09-15-reveal-in-folder.zh.md)

The Files panel's preview header gained a **Show in folder** button beside Download: it opens the
previewed file's directory in the machine's own file manager, which is where a file goes on being
worked on once the Agent has written it.

## What changed

- The button is drawn only when the page IS the desktop app's own window — the server was spawned
  by the shell, and this session was established through the shell's one-shot token. A browser
  signed into the same server does not get it even when it runs on that very machine: the server
  cannot tell that browser from one on the other side of a network, and a folder springing open
  beside the server means nothing to whoever is actually looking at the page. The same two fields
  are enforced on the server — no desktop mode is a 404, a browser session in desktop mode a 403
  `desktop_shell_only` — so the control and the endpoint agree on who may ask.
- macOS and Windows select the file itself (`open -R`, `explorer.exe /select,`); a Linux desktop
  opens the containing directory with `xdg-open`, which is the part of the request that can be
  asked for portably there.
- `POST /api/sessions/:sessionId/files/reveal?path=` is the new endpoint, taking the
  Workspace-relative path the way `GET /files/content` does and answering 204. The path goes
  through the read path's own resolution before it reaches the OS, so a `..` and a symlink
  pointing out of the Workspace are refused exactly as they are for a read, and a path that is not
  there is a 404 rather than a path the file manager is asked to find. A command that cannot be
  started at all — a headless box with no `xdg-open` — comes back as 502 `reveal_failed` and the
  panel says so.
- The reveal never waits for the file manager to exit: the child is detached and unref'd, and only
  its start is awaited.
