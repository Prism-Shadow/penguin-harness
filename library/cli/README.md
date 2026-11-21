# @prismshadow/penguin-library-cli

The CLI host's face for command code: what a `penguin` command's code may use from the host
without importing `@prismshadow/penguin-server` or `@prismshadow/penguin-cli`.

## What lives here

- `src/client.ts` — `ServerClient` (Bearer-token auth, the 401 file-token refresh, the 403
  `human_required` sign-in retry, SSE) and `ApiError`, plus the session-reference helpers.
- `src/connection.ts` — `resolveConnection`: `--server`, `PENGUIN_API_URL`, the data root's
  live lock, then auto-start.
- `src/console-input.ts` — `terminalInput`: stdin, or the Windows console's own input when the
  desktop app's executable runs the CLI with none.
- `src/cut-text.ts`, `src/table.ts` — `cutText`, `displayWidth`, `renderTable`.
- `src/messages.ts` — `ClientText` (the server-connection message group the code above words
  its errors with) and `CliHostMessages` (the part of the CLI host's bundle a command module may
  count on). The texts themselves are the host's message table.
- `src/server-lock.ts`, `src/stored-sign-in.ts` — the readers of `<root>/server.lock` and
  `<root>/cli-session.json`. The server package writes both and re-exports the readers.

## The dependency rule

Imported by the server package (its `cli` subpath re-exports everything here, so the CLI's own
commands keep importing from there) and by a shipped plugin's CLI module, the `./cli` export the
CLI boots at build time (`rfcs/PRFC-0024-cli-modules.md`). The server and the CLI both depend on
the plugins they ship, so a plugin cannot import either back; this package sits below all three
and imports none of them. Like the other library packages it is private and bundled by whoever
imports it.
