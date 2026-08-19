# The harness's own port stops colliding: out of the Agent's environment, off the dev server

- **Date:** 2026-07-29
- **Type:** fix
- **Scope:** `core`, `tooling`
- **PR:** [#100](https://github.com/Prism-Shadow/penguin-harness/pull/100)

[中文版](2026-07-29-harness-env-and-dev-ports.zh.md)

Two places where PenguinHarness's listen port reached somewhere it should not have.

## `PORT` no longer leaks into commands the Agent runs

`penguin web` writes `PORT` and `HOST` into its own `process.env` as the channel to the server module, and the command Environment built child environments straight from `process.env`. Every `exec_command` therefore inherited `PORT=7364` — and `npm run dev`, Vite, Next and most Express templates read `PORT`, so an Agent asked to start a dev server tried to bind **the harness's own port** instead of picking one.

The child environment now drops `PORT`, `HOST`, and the internal `PENGUIN_CLI_ENTRY` / `PENGUIN_WEB_DIST`. Keys are removed rather than blanked, since a program may test `PORT` for presence rather than value. Stripping applies even when the value came from the user's shell (`PORT=3000 penguin web`): it still means "the port PenguinHarness is on", which is precisely the port a spawned server must avoid. The Agent's vault is applied afterwards, so setting `PORT` there deliberately still reaches commands.

`PENGUIN_HOME` and the other user-facing `PENGUIN_*` settings are deliberately kept — an Agent working on PenguinHarness itself may legitimately want the same data root, and that is a configuration decision rather than a leak.

## The development backend moves off 7364

`pnpm dev:server` bound the same port as an installed `penguin web`, and the two routinely run at once. Either the dev server failed to bind, or — quieter and worse — the Vite proxy talked to the **installed** server instead of the one being worked on, so code changes appeared to do nothing.

The development backend now listens on **7368**; 7365, 7366 and 7367 are already the web, landing and docs dev servers. `pnpm dev:web` is unchanged at 7365 and remains the address to open — only what it proxies to has moved. The full port allocation is documented in `core/internal/ports.ts`, which is where a reader looks, even though the dev ports themselves have to be literals in vite configs and package.json scripts.

Overrides still work and now move together: the dev scripts apply `PORT` only when it is unset, and the Vite proxy reads `PORT` with 7368 as its fallback, so changing the backend port carries the proxy with it instead of leaving it pointed at the old one.

The dev *data root* was separated from the installed one for exactly this reason; this finishes the job for the port.
