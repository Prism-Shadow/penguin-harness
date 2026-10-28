# Stop retrying frees the machine, and a person's job never waits behind automatic work

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1378](https://github.com/Prism-Shadow/penguin-harness/pull/1378)

[中文版](2026-10-27-machine-stop-retrying-frees-machine.zh.md)

Stop retrying on a machine now ends the reconnect attempt in flight at once: its ssh command is ended, what it would have learned is discarded and not counted, and the connection it was opening is closed, so nothing redials. Update, Restart server, Stop server, Uninstall and Start server then start on that machine straight away, instead of reading as queued or being refused.

## Details

- A person's job never waits behind this server's own work on a machine: a reconnect attempt, the connection check, the hand-over at boot, or the reinstall a stream asks for when it cannot reach the machine. That work is cut when the job starts. A cut reconnect attempt is not counted, and the reconnects look again once the job is done.
- Retry after Stop retrying starts the first attempt of a new round at once.
- A job that goes through on a machine whose reconnects had stopped, and leaves it still not connected (Restart server after Stop retrying), starts a new round of reconnects.
