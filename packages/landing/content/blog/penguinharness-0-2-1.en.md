---
title: "PenguinHarness 0.2.1: the desktop app and a download page"
date: 2026-08-04
category: news
excerpt: 0.2.1 adds a desktop app for macOS, Windows and Linux that opens already signed in and shares its data with the CLI. It also brings a download page backed by an OSS mirror, download-source control for installs and updates, and a hardened login.
---

PenguinHarness 0.2.1 is out, and the headline is the desktop app: no terminal and no login page, just double-click an icon to open the full PenguinHarness. Around it, distribution improves too: a new download page serves installers from an Alibaba Cloud OSS mirror, and install scripts and `penguin update` can choose their download source. Compaction failures no longer trap Sessions, and the first-start admin password is now random.

## The desktop app

The desktop app is a deliberately thin Electron shell. It starts the existing server as a child process and points its window at `http://localhost`. There is no private IPC, preload script or Node integration, so everything still goes through the same HTTP API. It opens already signed in as the admin through a one-time token, so there is no login page and no initial password to copy down.

Data is fully shared with CLI installs under `~/.penguin/data`, so you can use the desktop app and `penguin web` interchangeably. A data root only ever runs one server: a new `server.lock` guard, which the CLI and the app both honor, makes sure of that. If a server started from the CLI is already running, the app simply attaches to it.

UI preferences such as language and theme survive restarts. The app remembers the port the server last used and reuses it while it is still free, which keeps the window's origin stable, and with it the browser storage that holds your preferences.

Installers are available for:

- macOS: dmg, for Apple silicon and Intel
- Windows: NSIS
- Linux: AppImage and deb

The 0.2.1 builds are unsigned. On first launch on macOS, right-click the app and choose "Open". On Windows, get past SmartScreen with "More info → Run anyway".

## A download page, with desktop installers on the OSS mirror

0.2.1 adds [penguin.ooo/download](https://penguin.ooo/download), a classic software download page: one card per platform, with your system detected and marked, and a click to download.

Installers now have version-less file names, which let the page's buttons start on GitHub's static `releases/latest/download` links. At launch, the page read the OSS mirror's `latest.json` in the background. If that succeeded, the buttons switched to the mirror's fixed per-version directory, and the page showed the resolved version with a toggle to switch the source by hand. Desktop installers are mirrored byte for byte to Alibaba Cloud OSS, just like the CLI bundles.

## Install scripts and penguin update choose their download source

An `install.sh` or `install.ps1` saved from a Release page now follows the same policy as the penguin.ooo install scripts: `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`, where `auto` prefers OSS and falls back to the same version on GitHub. Newly published install scripts also embed their own Release tag. However long you keep one, it downloads the matching version instead of silently following a later release.

`penguin update` follows the same rules. Upgrades no longer start at GitHub: version discovery prefers the OSS `latest.json`, the `oss` and `github` modes never fall back, and failures are reported in your language.

## Compaction failures no longer trap Sessions

Some models write `[summary]` as a title and put the body after the closing tag. The old logic extracted an empty summary, and every retry showed the model its own bad output to copy again, locking the Session in a failing loop.

In 0.2.1, summary extraction tolerates these malformed formats. A response that is still unusable is retried on the standard retry budget and backoff, with a corrective note to the model. The attempts and Tokens that retries burn now show up in the stats and the **Cost Center**, and the retry details (`error_message` / `attempt` / `retry_in_ms`) are visible in both the CLI and the Web App.

## A hardened login

The fixed seed password `penguin-2026` is retired. The first start now generates a random password, `penguin-` followed by four digits, and prints it exactly once. The login endpoint also throttles failed attempts per username: after 5 failures, attempts wait for a delay that starts at 1 second and doubles up to 60 seconds, which makes guessing through the four-digit space impractical.

## Web App improvements

### Skills in the app

**Agent settings** gains a **Skills** tab that lists the Skills installed on disk, with uninstall, zip import and export, and installing through chat. The new `skill-porting` library Skill brings in Skills from other ecosystems and normalizes them.

### New chat defaults

**Project settings** gains **New chat defaults**: the default agent, working directory, approval mode, thinking level and model that every new draft starts with.

### A faster Trajectories page

The **Trajectories** page shares the sidebar's grouping components, pages its sessions on the server, and finds Trace files through a SQLite index instead of walking the filesystem on every request.

### Chat page

- The outline tick rail shows a window of 20 turns on either side of your position and no longer overlaps the composer.
- The cost stat no longer disappears between Tasks.
- Uploaded file attachments render as part of your message, right-aligned with the same timestamp treatment as images, and also show inside steering chips.
- ANSI color codes no longer leak into tool output.

## Everything else

- The server's last two disk-IO hotspots are gone. The 30-second scheduler tick and the schedules routes read from caches that refresh only when files change, and `GET /messages` supports cursor pagination, so the Web App loads a conversation from its newest messages first.
- `hono` moves past the CORS-preflight ReDoS advisory.
- The OpenRouter catalog adds `qwen/qwen3.8-max`.

The full list, item by item, is in [changelog/0.2.1](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.1).

## Install or upgrade

Desktop app: download the installer for your platform at [penguin.ooo/download](https://penguin.ooo/download).

CLI / server:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

On Windows, run `irm https://penguin.ooo/install.ps1 | iex` in PowerShell. With Node >= 24, you can also install with `npm install -g @prismshadow/penguin-cli`. On Linux and macOS, upgrade an existing install with `penguin update`, which now downloads through the mirror as well.
