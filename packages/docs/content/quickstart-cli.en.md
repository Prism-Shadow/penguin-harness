---
title: CLI and Web App
description: One line installs penguin; configure a model and open the browser interface with penguin web — with the full installation reference.
---

One line installs `penguin`; `penguin web` then opens the same interface as the [desktop app](/quickstart-desktop) in your browser. The online installers bundle an official Node.js runtime — unpack and run, no local Node needed.

## Install

Pick your platform. The first two bundle their own Node.js runtime; the npm route needs Node.js >= 24 already installed.

```bash tab="Linux / macOS"
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell tab="Windows"
irm https://penguin.ooo/install.ps1 | iex
```

```bash tab="npm (any platform)"
npm install -g @prismshadow/penguin-cli
```

Verify the install:

```bash
penguin -v
```

Offline installs, installing from source, install locations, version pinning and Windows specifics are all in the [installation reference](#installation-reference) at the end of this page.

## Configure a model

Use the Models page in the Web UI, or the CLI:

```bash
penguin config model add --provider deepseek --model-id deepseek-v4-flash --api-key sk-... --set-default
```

- A model is always referenced as a `(provider, model_id)` pair, so `--provider` and `--model-id` are both required — the Provider is never inferred from the model id. See [Models & Providers](/models) for the built-in groups.
- The API key can also come from environment variables: when a model entry has no inline api_key, AgentHub (the LLM gateway library) reads variables such as `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`. A `.env` file in the working directory is loaded automatically.

## Start the Web App

```bash
penguin web
```

The service runs at http://127.0.0.1:7364 and opens your browser (`--no-open` to skip). The account is `admin`, and it has no password yet: the server prints a first-login link in a framed notice, which opens the browser signed in so you can set one. The link works until a password exists (30-day ceiling — a restart prints a fresh one), and you can reopen it as often as you need. `penguin server` starts the same process headless.

The [Web App Guide](/web-app) covers the interface in full.

## One-shot run

```bash
penguin run -m "Create hello.txt containing Hello, Penguin"
```

The Workspace defaults to the current directory; pass `--workspace /path` to change it. The target directory must already exist.

`run`, `chat` and the other session commands are thin clients of the server: they attach to the local server when one is running and quietly start one when none is (no login needed on the local machine — see the [CLI Reference](/cli) for the connection rules). Everything they create shows up in the Web App too, and `penguin ls` / `penguin logs` / `penguin input` address those sessions from the terminal.

## Interactive chat

```bash
penguin chat
```

- Each input line starts a Task.
- `/compact` compacts the context; `/clear` starts a fresh Session (the old one stays resumable); `/exit` or `/quit` quits; Ctrl-C interrupts the running Task.
- On exit it prints a `penguin chat --resume <sessionId>` hint for resuming this Session; `--resume` without an id resumes the Agent's latest Session.

The full command and option list is in the [CLI Reference](/cli).

## Installation reference

The three commands above cover nearly every case; the rest of the options and details follow.

### Requirements

- Linux / macOS (x64 or arm64): the install script ships platform tarballs with an official Node.js runtime bundled — no local Node needed.
- Windows 10 or later (x64) with PowerShell 5.1+: the Windows installer ships `penguin-win32-x64.zip` with the runtime bundled — no local Node needed.
- Other platforms, or installing via npm / from source: system Node.js >= 24.

### Install script details

The script downloads the matching `penguin-{linux,darwin}-{x64,arm64}.tar.gz` — the canonical installer bundle, sealing the program payload (with an official Node.js runtime), the payload's SHA256 checksum and this same installer. The download is verified against its published `.sha256`, then the sealed payload checksum is verified again before anything is staged. Other POSIX platforms do **not** fall back automatically: the script exits and asks you to install Node.js >= 24 and re-run with `--universal`, which selects the runtime-less `penguin-universal.tar.gz` bundle (Windows is served by its own installer, not by `--universal`).

The stable entry point defaults to `PENGUIN_DOWNLOAD_SOURCE=auto`: it resolves the target through an immutable OSS release directory only after that release has been completely uploaded and verified, and falls back to the matching GitHub Release if the metadata is unavailable. Which source then serves the package is measured, not assumed. The installer times a probe file on GitHub and keeps GitHub whenever it reaches 256 KB/s; only below that does it measure the OSS mirror, and it switches only when the mirror is more than 1.5x faster — a mirror that is merely a little quicker is not worth its bandwidth bill, and a slow GitHub download still resumes. Set `PENGUIN_DOWNLOAD_SPEED_PROBE=0` to skip the measurement, or `PENGUIN_DOWNLOAD_SOURCE` to `oss` or `github` to force either source. Normal installer output names the source without printing the mirror's full URL.

The `penguin.ooo` stable entry resolves the current stable version each time it runs. A standalone script downloaded from a versioned GitHub or OSS Release is stamped with that Release tag and defaults to the same version, keeping the installer and package format matched; set `PENGUIN_VERSION` (or `--version` on POSIX) to override it explicitly. To pin a version on Windows, set the env var before running the installer:

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

### Offline install

The same Release artifacts serve offline installation — there is no separate offline package. Download the file matching the target computer on a connected machine (`penguin-<target>.tar.gz`, or `penguin-win32-x64.zip` for Windows), transfer that one file, then extract it once.

On Windows, double-click `install.cmd`, or run:

```powershell
.\install.ps1
```

On Linux / macOS, run:

```bash
./install.sh
```

The extracted bundle keeps the installer, the program payload (`payload.tar.gz` / `payload.zip`) and the payload's `.sha256` together; the installer finds the sibling payload by itself, always verifies the sealed checksum and performs no network requests — no separate checksum file needs to be transferred. You can also point the installer at a file explicitly: `install.sh --archive <file>`, `PENGUIN_ARCHIVE=<file>`, `install.ps1 -ArchivePath <file>`, or `$env:PENGUIN_ARCHIVE` — accepting a Release bundle, its inner payload, or a pre-0.1.6 legacy program archive alike.

### From source

Requires Node.js >= 24 and pnpm:

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

After the build, run `pnpm penguin <args>` inside the repo as the dev runner, or use the globally linked `penguin` command. Dev entry points (`pnpm penguin`, `pnpm dev`, `pnpm desktop`) default to a separate data root `~/.penguin/dev-data`, while the linked/installed `penguin` keeps `~/.penguin/data`; export `PENGUIN_HOME` to override. The desktop dev run also uses its own app identity (`PenguinHarness-Dev`), so it can run alongside an installed desktop build without conflicts.

### Install location and options

| Item | Details |
| --- | --- |
| Install dir | `$XDG_DATA_HOME/penguin` (`~/.local/share/penguin`) by default; override with the `PENGUIN_INSTALL_DIR` env var. Your data stays in `~/.penguin/data` either way — installs up to v0.2.2 kept the program beside it, and re-running the installer moves it out |
| Command entry | A symlink `~/.local/bin/penguin` is created (the script warns if `~/.local/bin` is not on PATH) |
| Version selection | `PENGUIN_VERSION=vX.Y.Z` env var, or the `--version vX.Y.Z` script flag; the stable entry defaults to the latest Release, while a versioned Release installer defaults to its own tag |
| Download source | `PENGUIN_DOWNLOAD_SOURCE=auto` (default), `oss`, or `github`; auto times a probe file and keeps the free GitHub download unless the OSS mirror is clearly faster, falling back to the same version on the other source (`PENGUIN_DOWNLOAD_SPEED_PROBE=0` skips the measurement) |
| Local archive | `PENGUIN_ARCHIVE=<file>` or `--archive <file>`; accepts a Release bundle (self-verifying via its sealed payload checksum) or a payload/legacy program archive with an adjacent `<file>.sha256` (renamed legacy files may use the platform asset's canonical `.sha256`) |
| Integrity check | Always on: online downloads are verified against the published `.sha256`, and bundle payloads against the checksum sealed inside the bundle |
| Upgrade | Re-run the install script; files are swapped atomically |

Script flags go after `sh -s --`, e.g. `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal`.

### Windows specifics

| Item | Details |
| --- | --- |
| Install dir | `%LOCALAPPDATA%\penguin` by default; override with the `PENGUIN_INSTALL_DIR` env var. Your data stays in `%USERPROFILE%\.penguin\data` either way — installs up to v0.2.2 kept the program beside it, and re-running the installer moves it out |
| Command entry | the `bin\penguin.cmd` launcher (deliberately no `.ps1` launcher — batch files are exempt from the PowerShell execution policy, so `penguin` works even under the default Restricted policy); the installer adds `%LOCALAPPDATA%\penguin\bin` to your **user** Path and broadcasts the change — open a **new terminal window** once (a new tab of an already-running terminal keeps the old Path) |
| Version pin | `$env:PENGUIN_VERSION = "vX.Y.Z"` before running the installer |
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

### Published npm packages

| Package | Description |
| --- | --- |
| `@prismshadow/penguin-cli` | Command-line tool providing the `penguin` command |
| `@prismshadow/penguin-core` | SDK for creating Agents and Sessions programmatically |
| `@prismshadow/penguin-server` | Web service, including the Web UI assets |
| `@prismshadow/penguin-skills` | Skill collection |

All packages are published under the Apache-2.0 license.

## Next steps

- [Web App Guide](/web-app): use PenguinHarness from the browser.
- [CLI Reference](/cli): the full list of commands and options.
- [SDK](/quickstart-sdk): embed the engine in your own program.
