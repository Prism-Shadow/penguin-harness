# A dev instance's own CLI answers `penguin`, in agents' commands and in terminals

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`, `tooling`, `docs`
- **PR:** [#955](https://github.com/Prism-Shadow/penguin-harness/pull/955)

[中文版](2026-10-03-dev-cli-on-path.zh.md)

A Web App dev server (`pnpm dev`) or a desktop dev run (`pnpm desktop`) now hands its own build of the CLI to agents' commands and to the Terminal panel. Before, that CLI failed to load in a dev instance, and a new terminal ran whatever `penguin` the machine had installed.

## Dev prebuild

- `scripts/dev-prebuild.mjs` builds `packages/hmr` and the JavaScript of `packages/server` between core and the CLI. The CLI imports server modules at runtime (the lock, token minting, the version report). A dev server runs its source under `tsx` and never built them, so `<root>/bin/penguin` stopped at `ERR_MODULE_NOT_FOUND` for `penguin-server/dist/…`.
- `PENGUIN_BUILD_JS_ONLY=1` makes the server's build skip its declarations and keep the ones an earlier full build left. The prestep takes about 7 s on a 24-core machine (3.6 s before; 15 s with the server's declarations).
- The server's build script also regenerates `src/ifaces.json`, so a dev server starts on a current interface table.
- `pnpm desktop` already built everything; its CLI loads unchanged.

## Terminals

- Every terminal the Terminal panel opens puts the directory of the server's CLI shim, the one agents' commands get, first on PATH after the user's own startup files have run: bash through `--rcfile`, zsh through a `ZDOTDIR` whose files source the user's own, fish through `--init-command`, PowerShell through `-NoExit -Command`, cmd through `/K`, and sh, dash and ash through `ENV`. Other shells get the directory at the front of the inherited PATH only.
- The startup files live in `<root>/shell-startup/`, are rewritten only when their content changes, and print nothing. The user's aliases, prompt and history are kept, and so is macOS `path_helper` ordering behind the shim.
- A bash terminal is now an interactive non-login shell that runs the login files itself: `logout` asks for `exit`, `~/.bash_logout` is not read, and on Debian-family systems `/etc/bash.bashrc` runs twice.
- The Configuration, Chat and CLI quickstart docs say so.

## Compatibility

No compatibility code was added: `<root>/shell-startup/` is a new directory that an older server never reads.
