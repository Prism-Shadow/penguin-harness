---
title: Installation
description: Install PenguinHarness via the install script, npm, or from source.
---

## Requirements

- Linux / macOS (x64 or arm64): the install script ships platform tarballs with an official Node.js runtime bundled — no local Node needed.
- Offline profile: system CPython 3.9–3.13 with `venv`; Linux requires glibc 2.17 or newer and does not support musl/Alpine.
- Windows 10 or later (x64) with PowerShell 5.1+: the Windows installer ships `penguin-win32-x64.zip` with the runtime bundled — no local Node needed.
- Other platforms, or installing via npm / from source: system Node.js >= 24.

## Script install (recommended)

On Linux / macOS:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

For the matching native offline profile (containing `word-docx`, `powerpoint-pptx`, and `pdf-tools`):

```bash
curl -fsSL https://penguin.ooo/install.sh | sh -s -- --offline
```

By default, the script downloads the matching standard `penguin-{linux,darwin}-{x64,arm64}.tar.gz` bundle, so existing install behavior is unchanged. `--offline` selects the corresponding `penguin-offline-{linux,darwin}-{x64,arm64}.tar.gz`; it cannot be combined with `--universal` or `--archive`. Each bundle seals the program payload (with an official Node.js runtime), the payload's SHA256 checksum and this same installer. The download is verified against its published `.sha256`, then the sealed payload checksum is verified again before anything is staged. Other POSIX platforms **do not** fall back automatically: the script exits and asks you to install Node.js >= 24 and re-run with `--universal`, which selects the runtime-less `penguin-universal.tar.gz` bundle (Windows is served by its own installer below, not by `--universal`).

The stable entry point defaults to `PENGUIN_DOWNLOAD_SOURCE=auto`: it prefers an immutable OSS release directory only after that release has been completely uploaded and verified, then falls back to the matching GitHub Release if the metadata or download is unavailable. Set the variable to `oss` or `github` to force either source. Normal installer output names the source without printing the mirror's full URL.

The `penguin.ooo` stable entry resolves the current stable version each time it runs. A standalone script downloaded from a versioned GitHub or OSS Release is stamped with that Release tag and defaults to the same version, keeping the installer and package format matched; set `PENGUIN_VERSION` (or `--version` on POSIX) to override it explicitly.

On Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
```

For the Windows x64 offline profile:

```powershell
& ([scriptblock]::Create((irm https://penguin.ooo/install.ps1))) -Offline
```

To pin a version, set the env var first:

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

Verify the install:

```bash
penguin -v
```

### Offline install

The same Release artifacts serve offline installation. Download the file matching the target computer on a connected machine: `penguin-<target>` for the lightweight standard profile, or `penguin-offline-<target>` for optional offline capabilities. Linux and macOS artifacts use `.tar.gz`; Windows uses `.zip`. The offline profile contains deterministic DOCX inspection/editing, PPTX inspection/slide append, and PDF inspection/merge Skills; future offline Skills extend the same profile. Transfer that one file, then extract it once.

Installing or upgrading Penguin never rewrites existing Agent State. A `default_agent` initialized after the offline profile is installed receives the current Skill library; for an existing Agent, install `word-docx`, `powerpoint-pptx`, and `pdf-tools` from the Skill library before selecting them.

On Windows, double-click `install.cmd`, or run:

```powershell
.\install.ps1
```

On Linux / macOS, run:

```bash
./install.sh
```

The extracted bundle keeps the installer, the program payload (`payload.tar.gz` / `payload.zip`) and the payload's `.sha256` together; the installer finds the sibling payload by itself, always verifies the sealed checksum and performs no network requests — no separate checksum file needs to be transferred. You can also point the installer at a file explicitly: `install.sh --archive <file>`, `PENGUIN_ARCHIVE=<file>`, `install.ps1 -ArchivePath <file>`, or `$env:PENGUIN_ARCHIVE` — accepting a Release bundle, its inner payload, or a pre-0.1.6 legacy program archive alike.

### Install location and options

| Item | Details |
| --- | --- |
| Install dir | `~/.penguin` by default; override with the `PENGUIN_INSTALL_DIR` env var |
| Command entry | A symlink `~/.local/bin/penguin` is created (the script warns if `~/.local/bin` is not on PATH) |
| Version selection | `PENGUIN_VERSION=vX.Y.Z` env var, or the `--version vX.Y.Z` script flag; the stable entry defaults to the latest Release, while a versioned Release installer defaults to its own tag |
| Download source | `PENGUIN_DOWNLOAD_SOURCE=auto` (default), `oss`, or `github`; auto prefers OSS and falls back to the same GitHub version |
| Offline profile | `--offline` selects the matching Linux/macOS offline artifact; it cannot be combined with `--universal` or `--archive` |
| Local archive | `PENGUIN_ARCHIVE=<file>` or `--archive <file>`; accepts a Release bundle (self-verifying via its sealed payload checksum) or a payload/legacy program archive with an adjacent `<file>.sha256` (renamed legacy files may use the platform asset's canonical `.sha256`) |
| Integrity check | Always on: online downloads are verified against the published `.sha256`, and bundle payloads against the checksum sealed inside the bundle |
| Upgrade | Re-run the install script; files are swapped atomically |

Script flags go after `sh -s --`, e.g. `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal` or `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --offline`.

### Windows specifics

| Item | Details |
| --- | --- |
| Install dir | `%USERPROFILE%\.penguin` by default; override with the `PENGUIN_INSTALL_DIR` env var |
| Command entry | the `bin\penguin.cmd` launcher (deliberately no `.ps1` launcher — batch files are exempt from the PowerShell execution policy, so `penguin` works even under the default Restricted policy); the installer adds `%USERPROFILE%\.penguin\bin` to your **user** Path and broadcasts the change — open a **new terminal window** once (a new tab of an already-running terminal keeps the old Path) |
| Version pin | `$env:PENGUIN_VERSION = "vX.Y.Z"` before running the installer |
| Offline profile | execute the stable script block with `-Offline` to select `penguin-offline-win32-x64.zip`; it cannot be combined with `-ArchivePath` |
| Local archive | `$env:PENGUIN_ARCHIVE = "<file>"` or `-ArchivePath <file>`; accepts the Release bundle (self-verifying via its sealed payload checksum) or a payload/legacy zip with an adjacent `<file>.sha256` (renamed legacy files may use `penguin-win32-x64.zip.sha256`) |
| Integrity check | Always on: online downloads are verified against the published `.sha256`, and bundle payloads against the checksum sealed inside the bundle |
| Upgrade | Re-run the installer; it swaps `bin`/`lib`/`web`/`node` and never touches `data` |

- **Agent shell**: on Windows, the agent's `exec_command` runs in a POSIX shell, for compatibility with skills written for one. It picks, in order: `bash` on PATH (your own [Git for Windows](https://gitforwindows.org/), preferred because it carries the full MSYS userland); then the **bundled bash** — the Windows zip ships MinGit under `git\`, so a machine with no Git for Windows still gets a POSIX shell, about sixty core utilities and `git.exe`; then PowerShell (`pwsh`, then `powershell`). The PowerShell fallback is only reached by npm installs, which bundle nothing. The `PENGUIN_SHELL` env var overrides the pick; the session's system prompt tells the model which shell is active. The bundled shell's licensing is recorded in [THIRD-PARTY-NOTICES.md](https://github.com/Prism-Shadow/penguin-harness/blob/main/THIRD-PARTY-NOTICES.md).
- **Ctrl-C semantics**: on Windows, sending Ctrl-C to a running command session (`input_command` with `"\u0003"`) terminates the whole command session tree instead of interrupting the foreground command — Windows cannot deliver a console Ctrl-C to a piped child process, so the interrupt degrades to a hard tree kill.
- **In-place update**: `penguin update` is not yet supported on Windows — upgrade by re-running the installer above.
- **Config file permissions**: on POSIX, config/credential files are written with `0600` (owner-only) permissions; Windows has no such mode bits, so files fall under your profile's default NTFS ACLs.
- If PowerShell refuses to run `penguin` with "running scripts is disabled", the blocked file is a `penguin.ps1` launcher — from an install older than 0.1.6 (re-run the installer: upgrades replace `bin\` and remove it) or generated by an npm global install (call `penguin.cmd` explicitly, or allow local scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`). The packaged install itself ships only `penguin.cmd`, which runs under any execution policy.

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
