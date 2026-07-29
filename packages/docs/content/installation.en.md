---
title: Installation
description: Install PenguinHarness via the install script, npm, or from source.
---

## Requirements

- Linux / macOS (x64 or arm64): the install script ships platform tarballs with an official Node.js runtime bundled — no local Node needed.
- Windows 10 or later (x64) with PowerShell 5.1+: the Windows installer ships `penguin-win32-x64.zip` with the runtime bundled — no local Node needed.
- Other platforms, or installing via npm / from source: system Node.js >= 24.

## Script install (recommended)

On Linux / macOS:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

The script downloads the matching `penguin-{linux,darwin}-{x64,arm64}.tar.gz`, which bundles an official Node.js runtime. Other POSIX platforms do **not** fall back automatically: the script exits and asks you to install Node.js >= 24 and re-run with `--universal`, which selects the runtime-less `penguin-universal.tar.gz` (Windows is served by its own installer below, not by `--universal`).

On Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

To pin a version, set the env var first:

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

Verify the install:

```bash
penguin -v
```

### Install location and options

| Item | Details |
| --- | --- |
| Install dir | `~/.penguin` by default; override with the `PENGUIN_INSTALL_DIR` env var |
| Command entry | A symlink `~/.local/bin/penguin` is created (the script warns if `~/.local/bin` is not on PATH) |
| Version pin | `PENGUIN_VERSION=vX.Y.Z` env var, or the `--version vX.Y.Z` script flag; defaults to the latest Release |
| Integrity check | Downloads are sha256-verified when the Release ships checksum assets |
| Upgrade | Re-run the install script; files are swapped atomically |

Script flags go after `sh -s --`, e.g. `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal`.

### Windows specifics

| Item | Details |
| --- | --- |
| Install dir | `%USERPROFILE%\.penguin` by default; override with the `PENGUIN_INSTALL_DIR` env var |
| Command entry | `bin\penguin.cmd` and `bin\penguin.ps1` launchers; the installer adds `%USERPROFILE%\.penguin\bin` to your **user** Path (restart the terminal once) |
| Version pin | `$env:PENGUIN_VERSION = "vX.Y.Z"` before running the installer |
| Integrity check | Downloads are sha256-verified when the Release ships checksum assets |
| Upgrade | Re-run the installer; it swaps `bin`/`lib`/`web`/`node` and never touches `data` |

- **Agent shell**: on Windows, the agent's `exec_command` runs in a POSIX shell, for compatibility with skills written for one. It picks, in order: `bash` on PATH (your own [Git for Windows](https://gitforwindows.org/), preferred because it carries the full MSYS userland); then the **bundled bash** — the Windows zip ships MinGit under `git\`, so a machine with no Git for Windows still gets a POSIX shell, about sixty core utilities and `git.exe`; then PowerShell (`pwsh`, then `powershell`). The PowerShell fallback is only reached by npm installs, which bundle nothing. The `PENGUIN_SHELL` env var overrides the pick; the session's system prompt tells the model which shell is active. The bundled shell's licensing is recorded in [THIRD-PARTY-NOTICES.md](https://github.com/Prism-Shadow/penguin-harness/blob/main/THIRD-PARTY-NOTICES.md).
- **Ctrl-C semantics**: on Windows, sending Ctrl-C to a running command session (`input_command` with `"\u0003"`) terminates the whole command session tree instead of interrupting the foreground command — Windows cannot deliver a console Ctrl-C to a piped child process, so the interrupt degrades to a hard tree kill.
- **In-place update**: `penguin update` is not yet supported on Windows — upgrade by re-running the installer above.
- **Config file permissions**: on POSIX, config/credential files are written with `0600` (owner-only) permissions; Windows has no such mode bits, so files fall under your profile's default NTFS ACLs.
- If PowerShell refuses to run `penguin` with "running scripts is disabled", your execution policy blocks the `penguin.ps1` shim: either call `penguin.cmd` explicitly, or allow local scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Data directory

The data directory defaults to `~/.penguin/data` (`%USERPROFILE%\.penguin\data` on Windows) — under the install home, but never modified by install or upgrade — and is overridable with the `PENGUIN_HOME` env var. Model configuration, Session records, and other data are preserved across upgrades.

## npm install

Requires system Node.js >= 24:

```bash
npm install -g @prismshadow/penguin-cli
```

The npm package is `@prismshadow/penguin-cli`; the installed command is `penguin`. Web UI assets ship inside the `@prismshadow/penguin-server` package, so this single install yields a working `penguin web`. This route works on every platform (including Windows) and is the alternative when the packaged zip/tarball is unsuitable.

## From source

Requires Node.js >= 24 and pnpm:

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

After the build, run `pnpm penguin <args>` inside the repo as the dev runner, or use the globally linked `penguin` command. Dev entry points (`pnpm penguin`, `pnpm dev`) default to a separate data root `~/.penguin/dev-data`, while the linked/installed `penguin` keeps `~/.penguin/data`; export `PENGUIN_HOME` to override.

## Published npm packages

| Package | Description |
| --- | --- |
| `@prismshadow/penguin-cli` | Command-line tool providing the `penguin` command |
| `@prismshadow/penguin-core` | SDK for creating Agents and Sessions programmatically |
| `@prismshadow/penguin-server` | Web service, including the Web UI assets |
| `@prismshadow/penguin-skills` | Skill collection |

All packages are published under the Apache-2.0 license.

## Next steps

- [Quickstart](/quickstart): configure a model and run your first Task.
- [CLI Reference](/cli): the full list of commands and options.
