---
title: CLI and Web App
description: Install the penguin command, configure a model, open the Web App, and run your first Task from the terminal or the browser.
---

Install the `penguin` command with one line, configure a model, and run your first Task from the terminal or the browser. `penguin web` opens the same interface as the [desktop app](/quickstart-desktop), in your browser.

## Before you begin

- Linux or macOS (x64 or arm64), or Windows 10 or later (x64) with PowerShell 5.1 or later. The installers for these platforms bundle an official Node.js runtime, so you don't need Node.js on the machine.
- Node.js >= 24, if you install with npm, build from source, or use another platform.
- An API key for one model provider.

## Install the CLI

Run the installer for your platform. The Linux / macOS and Windows installers bundle their own Node.js runtime; the npm route needs Node.js >= 24 already installed.

```bash tab="Linux / macOS"
curl -fsSL https://penguin.ooo/install.sh | sh
```

```powershell tab="Windows"
irm https://penguin.ooo/install.ps1 | iex
```

```bash tab="npm (any platform)"
npm install -g @prismshadow/penguin-cli
```

Check the install:

```bash
penguin -v
```

The command prints the version you installed.

For offline installs, building from source, install locations, version pinning and Windows details, see the [Installation reference](#installation-reference) at the end of this page.

## Configure a model

PenguinHarness ships with no model credentials, so add a model before your first Task. This command adds DeepSeek's `deepseek-flash` and makes it the default:

```bash
penguin config model add --provider deepseek --model-id deepseek-flash --api-key sk-... --set-default
```

You can also add models later on the **Models** page of the Web App.

- A model is always named by a `(provider, model_id)` pair, so `--provider` and `--model-id` are both required. PenguinHarness never infers the provider from the model id. See [Models & Providers](/models) for the built-in groups.
- The API key can also come from an environment variable. When a model entry has no inline `api_key`, AgentHub (the LLM gateway library) reads variables such as `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY`. A `.env` file in the working directory is loaded automatically.

## Start the Web App

```bash
penguin web
```

The service starts at http://127.0.0.1:7364 and opens your browser. Add `--no-open` to skip opening the browser. `penguin server` starts the same process headless.

The account is `admin`, and it has no password yet. The server prints a first-login link in a framed notice. Open the link: the browser signs in, and you set a password.

> [!NOTE]
> The first-login link works until a password is set, for at most 30 days. You can open it as often as you need, and a restart prints a fresh one.

To find your way around the interface, see [Web App](/web-app).

## Run your first Task

Run a single Task from the terminal, or start a chat. Both work the same way underneath, described in [How terminal Sessions work](#how-terminal-sessions-work).

### Run a single Task

```bash
penguin run -m "Create hello.txt containing Hello, Penguin"
```

The command streams the agent's work and exits when the Task ends. The Task runs in the current directory, which becomes its Workspace. Pass `--workspace /path` to use another directory; it must already exist.

### Chat in the terminal

```bash
penguin chat
```

Each line you enter starts a Task. While chatting:

- `/compact` compacts the context.
- `/clear` starts a fresh Session. The old one can still be resumed.
- `/exit` or `/quit` quits.
- Ctrl-C interrupts the running Task.

When you quit, the chat prints a `penguin chat --resume <sessionId>` command that resumes this Session. `--resume` without an id resumes the agent's latest Session.

### How terminal Sessions work

`run`, `chat` and the other Session commands are thin clients of the server. They attach to the local server when one is running, and quietly start one when none is. On the local machine they need no login; the [CLI Reference](/cli) describes the connection rules.

Everything these commands create also shows up in the Web App, and `penguin ls`, `penguin logs` and `penguin input` work with those Sessions from the terminal. The [CLI Reference](/cli) lists every command and option.

## Installation reference

The install commands above cover nearly every case. This section holds the remaining options and details.

### Install script details

On Linux and macOS, the script downloads the bundle for your platform, `penguin-{linux,darwin}-{x64,arm64}.tar.gz`. This is the canonical installer bundle. It seals the program payload (with an official Node.js runtime), the payload's SHA256 checksum, and a copy of this same installer. The script verifies the download against its published `.sha256`, then verifies the sealed payload checksum before it stages anything. On Windows, the installer downloads `penguin-win32-x64.zip`, which bundles the runtime in the same way.

Other POSIX platforms do not fall back automatically. The script exits and asks you to install Node.js >= 24 and run it again with `--universal`, which selects the runtime-less `penguin-universal.tar.gz` bundle. Windows has its own installer and does not use `--universal`.

### Download source and version

The stable entry point defaults to `PENGUIN_DOWNLOAD_SOURCE=auto`. It resolves the target through an immutable OSS release directory, and only after that release has been completely uploaded and verified. If the metadata is unavailable, it falls back to the matching GitHub Release.

Which source then serves the package is measured, not assumed:

- The installer times a probe file on GitHub and keeps GitHub whenever the download reaches 256 KB/s.
- Only below that does it measure the OSS mirror, and it switches only when the mirror is more than 1.5x faster. A mirror that is only a little quicker is not worth its bandwidth bill, and a slow GitHub download still resumes.

Set `PENGUIN_DOWNLOAD_SPEED_PROBE=0` to skip the measurement, or set `PENGUIN_DOWNLOAD_SOURCE` to `oss` or `github` to force a source. The normal installer output names the source without printing the mirror's full URL.

The `penguin.ooo` stable entry resolves the current stable version each time it runs. A standalone script downloaded from a versioned GitHub or OSS Release is stamped with that Release's tag and installs the same version by default, which keeps the installer and the package format matched. To override the version, set `PENGUIN_VERSION`, or pass `--version` on POSIX systems. On Windows, set the variable before you run the installer:

```powershell
$env:PENGUIN_VERSION = "vX.Y.Z"; irm https://penguin.ooo/install.ps1 | iex
```

### Offline install

Offline installs use the same Release files as online installs; there is no separate offline package.

1. On a connected machine, download the file that matches the target computer: `penguin-<target>.tar.gz`, or `penguin-win32-x64.zip` for Windows.
2. Transfer that one file to the target computer and extract it.
3. In the extracted directory, run the installer. On Windows, double-click `install.cmd` or run `.\install.ps1`. On Linux and macOS, run `./install.sh`.

```powershell tab="Windows"
.\install.ps1
```

```bash tab="Linux / macOS"
./install.sh
```

The extracted bundle holds the installer, the program payload (`payload.tar.gz` / `payload.zip`) and the payload's `.sha256`. The installer finds the payload next to it by itself, always verifies the sealed checksum, and makes no network requests, so you don't need to transfer a separate checksum file.

You can also point the installer at a file explicitly: `install.sh --archive <file>`, `PENGUIN_ARCHIVE=<file>`, `install.ps1 -ArchivePath <file>`, or `$env:PENGUIN_ARCHIVE`. Each accepts a Release bundle, its inner payload, or a legacy program archive from before 0.1.6.

### Install from source

Building from source requires Node.js >= 24 and pnpm:

```bash
git clone https://github.com/Prism-Shadow/penguin-harness.git
cd penguin-harness
pnpm install && pnpm build
```

After the build, run `pnpm penguin <args>` inside the repository as the dev runner, or use the globally linked `penguin` command.

The dev entry points (`pnpm penguin`, `pnpm dev`, `pnpm desktop`) default to a separate data root, `~/.penguin/dev-data`, while the linked or installed `penguin` keeps `~/.penguin/data`. Set `PENGUIN_HOME` to override. The desktop dev run also uses its own app identity (`PenguinHarness-Dev`), so it can run alongside an installed desktop app without conflicts.

### Install location and options

| Item | Details |
| --- | --- |
| Install directory | `~/.penguin` by default; override it with the `PENGUIN_INSTALL_DIR` environment variable |
| Command entry | A symlink, `~/.local/bin/penguin`. The script warns if `~/.local/bin` is not on `PATH`. The `--no-modify-path` flag leaves the link alone, for a second installation beside the one `penguin` belongs to |
| Version | The `PENGUIN_VERSION=vX.Y.Z` environment variable, or the `--version vX.Y.Z` script flag. The stable entry installs the latest Release by default; a versioned Release installer installs its own tag |
| Download source | `PENGUIN_DOWNLOAD_SOURCE=auto` (default), `oss` or `github`. `auto` times a probe file and keeps the free GitHub download unless the OSS mirror is clearly faster, and falls back to the same version on the other source. `PENGUIN_DOWNLOAD_SPEED_PROBE=0` skips the measurement |
| Local archive | `PENGUIN_ARCHIVE=<file>` or `--archive <file>`. Accepts a Release bundle, which verifies itself with its sealed payload checksum, or a payload or legacy program archive with a `<file>.sha256` next to it. A renamed legacy file may use the platform asset's canonical `.sha256` |
| Integrity check | Always on. Online downloads are verified against the published `.sha256`, and bundle payloads against the checksum sealed inside the bundle |
| Upgrade | Run the install script again; files are swapped atomically |

Script flags go after `sh -s --`, for example `curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal`.

### Windows specifics

| Item | Details |
| --- | --- |
| Install directory | `%USERPROFILE%\.penguin` by default; override it with the `PENGUIN_INSTALL_DIR` environment variable |
| Command entry | The `bin\penguin.cmd` launcher. There is deliberately no `.ps1` launcher: batch files are exempt from the PowerShell execution policy, so `penguin` works even under the default Restricted policy. The installer adds `%USERPROFILE%\.penguin\bin` to your **user** Path and broadcasts the change. Open a **new terminal window** once; a new tab of an already-running terminal keeps the old Path. The `-NoModifyPath` switch leaves the Path alone, for a second installation beside the one `penguin` belongs to |
| Version pin | Set `$env:PENGUIN_VERSION = "vX.Y.Z"` before running the installer |
| Local archive | `$env:PENGUIN_ARCHIVE = "<file>"` or `-ArchivePath <file>`. Accepts the Release bundle, which verifies itself with its sealed payload checksum, or a payload or legacy zip with a `<file>.sha256` next to it. A renamed legacy file may use `penguin-win32-x64.zip.sha256` |
| Integrity check | Always on. Online downloads are verified against the published `.sha256`, and bundle payloads against the checksum sealed inside the bundle |
| Upgrade | Run the installer again. It swaps `bin`/`lib`/`web`/`node` and never touches `data` |

Other differences on Windows:

- **Agent shell**: the agent's `exec_command` runs in a POSIX shell, so Skills written for one keep working. The shell is picked in this order: `bash` on PATH, which is preferred because your own [Git for Windows](https://gitforwindows.org/) carries the full MSYS userland; then the **bundled bash**, since the Windows zip ships MinGit under `git\` and gives a machine without Git for Windows a POSIX shell, about sixty core utilities and `git.exe`; then PowerShell (`pwsh`, then `powershell`). Only npm installs, which bundle nothing, reach the PowerShell fallback. The `PENGUIN_SHELL` environment variable overrides the pick, and the Session's system prompt tells the model which shell is active. The bundled shell's licensing is recorded in [THIRD-PARTY-NOTICES.md](https://github.com/Prism-Shadow/penguin-harness/blob/main/THIRD-PARTY-NOTICES.md).
- **Ctrl-C**: sending Ctrl-C to a running command session (`input_command` with `"\u0003"`) terminates the whole command session tree instead of interrupting the foreground command. Windows cannot deliver a console Ctrl-C to a piped child process, so the interrupt becomes a hard kill of the tree.
- **In-place update**: `penguin update` is not yet supported on Windows. To upgrade, run the installer again.
- **Config file permissions**: on POSIX systems, config and credential files are written with `0600` (owner-only) permissions. Windows has no such mode bits, so these files fall under your profile's default NTFS ACLs.
- **"running scripts is disabled"**: if PowerShell refuses to run `penguin` with this error, the blocked file is a `penguin.ps1` launcher. It comes either from an install older than 0.1.6, which you fix by running the installer again (the upgrade replaces `bin\` and removes it), or from an npm global install, where you call `penguin.cmd` explicitly or allow local scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. The packaged install ships only `penguin.cmd`, which runs under any execution policy.

### Data root

The data root is `~/.penguin/data` by default (`%USERPROFILE%\.penguin\data` on Windows). It sits under the install directory, but installing and upgrading never modify it. Set the `PENGUIN_HOME` environment variable to use another directory. Model configuration, Session records and other data are kept across upgrades.

### Published npm packages

| Package | Description |
| --- | --- |
| `@prismshadow/penguin-cli` | Command-line tool that provides the `penguin` command |
| `@prismshadow/penguin-core` | SDK for creating agents and Sessions from code |
| `@prismshadow/penguin-server` | Web service, including the Web App assets |
| `@penguinharness/*` | The built-in plugins, one package each (Skills and session hooks); core loads them |

All packages are published under the Apache-2.0 license.

## Next steps

- [Web App](/web-app): use PenguinHarness from the browser.
- [CLI Reference](/cli): every command and option.
- [Update PenguinHarness](/updates): check your version and upgrade.
- [SDK](/quickstart-sdk): embed the engine in your own program.
