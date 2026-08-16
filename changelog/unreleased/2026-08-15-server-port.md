# One well-known server port: 7376

The server, the CLI and the desktop shell all use port **7376** now (it was 7364, and the desktop shell used to take whatever ephemeral port the OS handed out). The port stopped being merely a default and became an address: a client finds "this user's server" by probing one known number.

## What changed

- `DEFAULT_SERVER_PORT` is 7376, and the desktop shell's embedded server binds it instead of negotiating a port. `--port` / `PORT` still override it everywhere.
- The shell's remembered-port machinery is gone. It existed to keep the app origin — and with it the renderer's origin-scoped `localStorage` and cookies — stable across launches; a fixed port gives that by construction.
- A port already in use is no longer routed around. The shell still attaches to a live penguin server on the same data root before starting one, so this only bites when something else owns 7376, which is worth an error rather than a silently different origin.

## What it costs

One server per user per machine by default: a second instance needs an explicit port. That is the trade the fixed address buys, and it is the same constraint an SSH tunnel imposes anyway — the local port has to equal the remote one, because preview URLs are built from the server's own bound port.

Anyone who pinned the old number (bookmarks, firewall rules, reverse-proxy configs, `PORT=7364` in an `.env`) keeps working only if they keep setting it explicitly; the unset default now answers on 7376.
