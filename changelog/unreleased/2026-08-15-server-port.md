# One well-known server port

- **Date:** 2026-08-15
- **Type:** feature
- **Scope:** `core`, `cli`, `desktop`, `docs`

[中文版](2026-08-15-server-port.zh.md)

The server, the CLI and the desktop shell now treat port **7364** as an address rather than merely a default: a client finds "this user's server" by probing one known number, and can offer to install one when nothing answers. The number itself is unchanged — what changed is that it is now fixed.

## What changed

- The desktop shell's embedded server binds `DEFAULT_SERVER_PORT` instead of negotiating whatever ephemeral port the OS hands out. `--port` / `PORT` still override it everywhere.
- The shell's remembered-port machinery is gone. It existed to keep the app origin — and with it the renderer's origin-scoped `localStorage` and cookies — stable across launches; a fixed port gives that by construction.
- A port already in use is no longer routed around. The shell still attaches to a live penguin server on the same data root before starting one, so this only bites when something else owns 7364, which is worth an error rather than a silently different origin.

## What it costs

One server per user per machine by default: a second instance needs an explicit port. That is the trade the fixed address buys, and it is the same constraint an SSH tunnel imposes anyway — the local port has to equal the remote one, because preview URLs are built from the server's own bound port.
