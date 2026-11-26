# The first-login link under `pnpm dev` opens the App

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `server`, `tooling`
- **PR:** [#1454](https://github.com/Prism-Shadow/penguin-harness/pull/1454)

[中文版](2026-11-04-dev-claim-link-port.zh.md)

Under `pnpm dev`, the first-login link the server printed pointed at the backend's port 7368, which serves no App, so opening it ended on a "not found" error and the port had to be changed to 7365 by hand. `pnpm dev` now passes the App's port to the backend as `PENGUIN_DEV_APP_PORT=7365`, and the link points there.

## Details

- `PENGUIN_DEV_APP_PORT` changes only the first-login link. Workspace previews and the API address handed to Agents keep the backend's own port.
- Without the variable — `pnpm dev:server` alone, the installed app, the desktop app — the link is unchanged. An invalid value stops the server at startup instead of being ignored.
