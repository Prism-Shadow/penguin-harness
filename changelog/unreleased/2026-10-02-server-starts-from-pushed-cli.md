# A server starts from the pushed CLI, so its entry updates with a push and a restart

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `cli`, `desktop`, `server`, `hmr`

[中文版](2026-10-02-server-starts-from-pushed-cli.zh.md)

- When the data root has a pushed CLI, the `penguin server` / `penguin web` supervisor starts its server child through it (`penguin-hmr`). This covers the first start, every restart the server requests, and a server the CLI starts on its own when none is running. When nothing was pushed, or the record names a bundle the store no longer holds, the server starts on the installed CLI as before.
- The desktop app starts its embedded server the same way: through the pushed CLI when the data root has one, otherwise from the server bundled with the app.
- Code on the server's entry side, such as the process entry and the terminal WebSocket handshake, now reaches an installation with a push followed by a restart, without a reinstall. A push still does not restart the server.
- A server started through the pushed CLI exports that CLI (the `penguin-hmr` loader) as `PENGUIN_CLI_ENTRY`. Once a push has landed, the `penguin` an Agent runs and the Web App's self-update both run the pushed CLI. `penguin update` identifies the installation from the script the process runs, which is the loader, rather than from its own module. The desktop app bundles the loader too.
- A push whose CLI bundle cannot be started is refused with `400`, which names the error, and nothing lands. Before the push is handed to the upgrade, the bundle is started the way a start path starts it: this installation's `penguin-hmr` loader runs it with `--version` on a scratch data root, in a separate process. A CLI named by sha is read from the store, through a `readBlob` the HMR control object now exposes. Without this check, a broken CLI would keep a server down at its next restart, since every start path now runs the pushed CLI.
