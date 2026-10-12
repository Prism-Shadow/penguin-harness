# A checkout's `penguin` no longer runs against the installed data root

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `core`, `server`, `cli`, `docs`
- **PR:** [#1056](https://github.com/Prism-Shadow/penguin-harness/pull/1056)

[中文版](2026-10-12-dev-cli-data-root.zh.md)

`pnpm build` links the checkout's CLI globally, and that `penguin` ran without the `PENGUIN_HOME` that `pnpm penguin` sets, so it used the installed release's data root, `~/.penguin/data`. A command there that read a Project's config, such as `penguin config model list`, migrated the file to MMSP's client-type names, after which the installed release failed every Session (`400 … deepseek-official is not supported`). Code run from a checkout now defaults to the dev CLI's data root, and a migration is no longer written back while an older server serves the data root.

## Details

- With `PENGUIN_HOME` unset, code running from a source checkout defaults to `~/.penguin/dev-data-cli`, the data root of `pnpm penguin`. That covers the globally linked `penguin`, a server it starts, and anything else started from the checkout outside the dev scripts. Core decides this at run time from where it is loaded: a checkout is a directory above it that holds `pnpm-workspace.yaml` and this repository's `packages/core`. Installations keep `~/.penguin/data`: the installer's CLI, the desktop app, and the SDK installed from npm, including inside another pnpm workspace. `pnpm dev` and `pnpm desktop` still set `~/.penguin/dev-data`, and a set `PENGUIN_HOME` still takes precedence.
- A server records its version in `<root>/server.lock`. While a live server older than the running code holds a data root, the one-time migration of a `.project_config.toml` there is applied in memory only and the file is left as it was. The first such file in a data root prints which server holds it, and the file is written on a read after that server has been upgraded or stopped. Both readers of the file do this: `loadProjectConfig` in core, used by the CLI and the SDK, and the server's own reader. A lock without a version counts as older, see [backward compatibility](2026-10-12-backward-compatibility.md).
- The lock's reader moved to core as `@prismshadow/penguin-core/server-lock`. `@prismshadow/penguin-server/lock` re-exports it and keeps the writer.
- The CLI quickstart's "Install from source" section, the contributing guide and the manual-test skill state the data root of each dev entry point and of the linked `penguin`.

## Compatibility

Contributors whose linked `penguin` worked on `~/.penguin/data` no longer see that data from it. The data stays where it is. To reach it from a checkout, name it per command: `PENGUIN_HOME=~/.penguin/data penguin …`. Installed entry points are unaffected.
