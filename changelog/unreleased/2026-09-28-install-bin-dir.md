# install.sh: choose where the `penguin` link goes

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `tooling`, `docs`
- **PR:** [#994](https://github.com/Prism-Shadow/penguin-harness/pull/994)

[中文版](2026-09-28-install-bin-dir.zh.md)

`install.sh` took the install directory from `PENGUIN_INSTALL_DIR` but always put the `penguin` symlink in `~/.local/bin`. The link directory is now settable, so an installation and its command can live in one directory that is deleted whole — a test run or a side-by-side instance no longer has to redirect `HOME` to keep `~/.local/bin` clean.

## Details

- `PENGUIN_BIN_DIR=<dir>` or `--bin-dir <dir>` names the directory that receives `penguin`; the default stays `~/.local/bin`. The path must be absolute; a relative one is refused before anything is downloaded or staged.
- The "not on your PATH" note names the chosen directory; for the default it still prints `$HOME/.local/bin`.
- `--no-modify-path` wins over a bin directory: no link is created and no directory made, so an inherited `PENGUIN_BIN_DIR` cannot redirect a machine install.
- `scripts/test-installer.sh` installs with each form under an empty `HOME` and asserts nothing is written there.
- The CLI quickstart (both languages) lists the new option.
