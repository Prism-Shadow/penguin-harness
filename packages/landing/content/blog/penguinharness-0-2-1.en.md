---
title: "PenguinHarness 0.2.1: the desktop app arrives"
date: 2026-08-04
category: news
excerpt: 0.2.1 packs the full Web experience into a double-click desktop app — installers for macOS / Windows / Linux, signed in on open, sharing one data root with CLI installs. Around it, a software download page goes live with the installers mirrored to Alibaba Cloud OSS, standalone install scripts and penguin update learn to pick their download source, compaction failures stop trapping sessions with their retry costs finally visible, and the seeded admin password goes random with login throttling. Here is what shipped.
---

PenguinHarness 0.2.1 is out. The headline is the desktop app: no terminal, no login page — double-click an icon and you are in the full PenguinHarness. Around it, the distribution pipeline and download experience level up too. Feature by feature:

## The desktop app

A deliberately thin Electron shell: it forks the existing server as a child process and points its window at `http://localhost` — no private IPC, no preload, no node integration; every capability still flows through the same HTTP API. It opens already signed in: a one-shot token lands an admin session, so there is no login page and no initial password to copy down.

Data is **fully shared** with CLI installs under `~/.penguin/data`: the desktop app and `penguin web` can be used interchangeably, and a data root only ever runs one server (a new `server.lock` single-instance guard that the CLI and the shell both honor) — if a CLI-started instance is already up, the app simply attaches to it. UI preferences (language, theme) survive restarts: the shell remembers the port the server last bound and reuses it while still free, keeping the window origin — and the origin-scoped browser storage behind your preferences — stable.

Installers cover macOS (dmg, Apple silicon / Intel), Windows (NSIS) and Linux (AppImage / deb). Current builds are unsigned: on first launch use right-click → Open on macOS, and "More info → Run anyway" past Windows SmartScreen.

## A download page, and desktop installers on the OSS mirror

[penguin.ooo/download](https://penguin.ooo/download) is a classic software download page: one card per platform, your detected system badged, click to download. Buttons default to GitHub's static `releases/latest/download` links — made possible by the installers moving to version-less names — while the page resolves the OSS mirror's `latest.json` in the background and, on success, switches to the mirror's immutable per-version directory, showing the resolved version with a manual source toggle. Desktop installers are mirrored byte-for-byte to Alibaba Cloud OSS, just like the CLI bundles.

## Install scripts and penguin update pick their download source

An `install.sh` / `install.ps1` saved from a Release page now follows the same policy as the penguin.ooo forwarding layer: `PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`, with `auto` preferring OSS and falling back to the same version on GitHub. Newly published installers embed their own Release tag, so however long you keep one around it downloads the matching version instead of silently following a future latest. `penguin update` adopts the same contract: upgrades no longer start at GitHub — version discovery prefers the OSS `latest.json`, forced modes are strict, and failures are reported localized.

## Compaction failures stop trapping sessions

Some models write `[summary]` as a title and put the body after the closing tag — the old logic extracted an empty summary, and every retry showed the model its own bad output to copy again, locking the session in a failing loop. In 0.2.1 summary extraction applies a tolerance ladder, unusable responses retry on the standard budget and backoff ladder with a corrective note, and the burned attempts and tokens finally land in stats and the cost center, with retry detail (`error_message` / `attempt` / `retry_in_ms`) visible in both the CLI and the Web.

## Login hardened

The fixed seed password `penguin-2026` retires: first start generates a random password, printed exactly once; the login endpoint throttles per username with exponential delays (5 free failures, 1s doubling to 60s), so the 4-digit space cannot be enumerated.

## Web App improvements

Skills become manageable in the interface: Agent settings gains a Skills tab listing the installed set from disk, with uninstall, zip import/export and chat-driven install; the new `skill-porting` library skill normalizes skills from other ecosystems in. Project settings gains "New chat defaults" — default agent, working directory, approval mode, thinking level and model, seeded into every new draft. The Traces page shares the session sidebar's grouping components, sessions page server-side, and trace discovery moves onto a SQLite index instead of per-request filesystem walks. On the chat page: the outline tick rail windows to ±20 turns and stops overlapping the composer, the cost stat no longer blinks out across task boundaries, uploaded file attachments render as user content (right-aligned with the same timestamp treatment as images, and visible inside steering chips), and ANSI color codes are kept out of tool output for good.

## Everything else

The server's last two IO hotspots close: the 30-second scheduler tick and the schedules routes serve from mtime-gated caches, and `GET /messages` gains cursor pagination with tail-first web loading. `hono` moves past the CORS-preflight ReDoS advisory, and the OpenRouter catalog gains `qwen/qwen3.8-max`. The full list, item by item: [changelog/0.2.1](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.1).

## Install or upgrade

Desktop app: grab your platform's installer at [penguin.ooo/download](https://penguin.ooo/download).

CLI / server:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell): `irm https://penguin.ooo/install.ps1 | iex`; or `npm install -g @prismshadow/penguin-cli` with Node >= 24. Existing installs: just `penguin update` — which, as of this release, rides the mirror too.
