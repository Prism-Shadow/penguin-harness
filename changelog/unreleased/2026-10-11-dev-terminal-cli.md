# A server's terminals and Agent commands run its own `penguin`, against that server

- **Date:** 2026-10-11
- **Type:** fix
- **Scope:** `server`, `cli`, `docs`

[中文版](2026-10-11-dev-terminal-cli.zh.md)

In a development instance started with `pnpm dev` or `pnpm desktop`, `penguin` typed in a terminal could run the installed CLI, or this checkout's CLI talking to the installed server. The `<root>/bin/penguin` launcher, the terminal's environment and its shell hooks were changed so that a server's terminals and Agent commands run that server's own CLI against that server.

## Details

- The launcher sets `PENGUIN_HOME` to its server's data root for the CLI it starts, unless the caller has set it, together with `PENGUIN_WEB_DB` when the server's database is not `<root>/web.db`; `--root`, `--server` and `PENGUIN_API_URL` still take precedence. Nothing is exported into the shell that runs it.
- A terminal no longer inherits the server process's `PENGUIN_*`, `PORT` and `HOST` variables, the set core already removed from Agent commands. An inherited `PENGUIN_API_URL` or `PENGUIN_HOME` had pointed `penguin` at another server, an inherited `PENGUIN_CLI_ENTRY` had retargeted a server started from the terminal, and an inherited `PENGUIN_HOME` or `PORT` had made `pnpm dev` typed there collide with the running instance. Variables the user's own startup files export are still set. Where no launcher names the data root (a server with no CLI to offer, or a pushed platform on an older runtime), the terminal keeps `PENGUIN_HOME` and `PENGUIN_WEB_DB` as before.
- bash, zsh and fish run the PATH statement as their last prompt hook (`PROMPT_COMMAND`, `precmd_functions`, the `fish_prompt` event) as well as after the startup files, so a prompt hook that puts another `penguin` first no longer wins from the first prompt on. The hook keeps the last command's exit status; on bash before 5.1, a `PROMPT_COMMAND` array gets it in its first element.
- A server running from TypeScript source (`pnpm dev`) offers the checkout's CLI source through the checkout's own tsx, so CLI edits and pulls apply without a restart. A built server (`pnpm desktop`, `node packages/server/dist/index.js`) offers the checkout's built CLI; each falls back to the other, and Electron uses the build only.
- A server running from a checkout whose CLI can run neither way writes a launcher that prints the reason and exits 1, instead of removing the launcher and leaving `penguin` to whatever else is on PATH. The server log says so.
- Each terminal of a server running from a checkout opens with one line naming the CLI `penguin` runs and the data root it targets, or why it cannot run. Any terminal whose launcher is missing says that `penguin` there is whatever PATH finds. Terminals of an installation show no such line.
- The `penguin chat` and `penguin run` banners show the build identity that `penguin --version` prints, which names a source build's commit, and the server they talk to, with its data root when that is how it was found.
- The CLI reference and the configuration and CLI quickstart pages describe the launcher's data root and the terminal's environment.
