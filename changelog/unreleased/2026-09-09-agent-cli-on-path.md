# An Agent's `penguin` is the harness running it

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `core`, `server`, `desktop`, `tooling`, `docs`
- **PR:** #TBD

[中文版](2026-09-09-agent-cli-on-path.zh.md)

Every command an Agent runs now finds this installation's own `penguin` first on its PATH. The server writes a launcher script into its data root at `<root>/bin/penguin` — it runs the CLI entry this installation was started from, on the server's own Node — and each Session puts that directory at the front of PATH for the commands it spawns. A command that asks the harness to do something reaches the harness it is running inside, rather than whatever version the machine happens to have installed globally.

## Details

- The CLI entry is `PENGUIN_CLI_ENTRY` when the environment carries one — `penguin server` / `penguin web` export their own entry, and the desktop shell now passes the app's bundled CLI to the server process it forks. Otherwise the server resolves the checkout it was loaded from, walking up to the directory holding `pnpm-workspace.yaml` and taking its `packages/cli/dist/penguin.js` when that file exists. The entry, or the fact that none was found, is named in one line at boot.
- The launcher is rewritten at every start, so an installation that moved is picked up by the next one. With no entry to point at, a launcher left by an earlier start is removed instead: one aimed at a path that is no longer there is worse than no `penguin` at all. `<root>/bin/penguin.cmd` is written alongside it on Windows, where commands may run in either `cmd`/PowerShell or the bundled bash.
- The directory is prepended twice, in the child environment and again as a statement in front of the command string (`export PATH=…` for Bourne-family shells, `$env:PATH = …` for PowerShell, `set "PATH=…"` for `cmd`). Commands run through a login shell, whose profile routinely rewrites PATH after the child environment was set; only the statement runs late enough to decide. Shells whose PATH syntax is neither of those — `fish`, or whatever `PENGUIN_SHELL` names — get the environment half alone. The command itself is otherwise untouched, exit status included, and the command a host lists for a background process is still the one the Agent wrote.
- Hook scripts get the same directories at the front of their PATH. They are spawned directly, with no shell, so the environment is all there is to set.
- `scripts/dev-prebuild.mjs` now builds `packages/cli` alongside `packages/core`, so a dev server has a current CLI to point at. Editing the CLI's sources still needs `pnpm --filter @prismshadow/penguin-cli build` — `tsx watch` does not rebuild it.
