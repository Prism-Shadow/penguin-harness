PenguinHarness 0.2.1 — the desktop app arrives: the full Web experience as a double-click application for macOS, Windows and Linux, opening already signed in, with installers on the new download page and the OSS mirror.

## Install

**Desktop app** (new): grab your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — served from the OSS mirror when it is reachable, GitHub otherwise. Current builds are unsigned: on first launch use right-click → Open on macOS, and "More info → Run anyway" past Windows SmartScreen.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

## Highlights

**The desktop app.** A thin Electron shell over the unchanged server and Web App: it forks the server on the shared `~/.penguin/data` root, opens its window already signed in — no terminal, no login page, no initial password — and everything still flows through the same HTTP API (no preload, no node integration). A per-root single-instance lock keeps the schedule scheduler and `web.db` single-writer safe across the shell and CLI alike; if a CLI-started server is already up, the app attaches to it. UI preferences survive restarts via a stable window origin (the shell reuses last launch's port when still free). Installers: macOS dmg (Apple silicon / Intel), Windows NSIS, Linux AppImage / deb.

**A download page with mirror-aware links.** [penguin.ooo/download](https://penguin.ooo/download) shows one card per platform with your OS badged. Buttons start on GitHub's static `releases/latest/download` links — installers now carry version-less names, which is what makes those links possible — and swap to the OSS mirror's immutable per-tag URLs once the bucket's `latest.json` resolves in the browser, with a manual source toggle and checksum links. Desktop installers are mirrored to OSS alongside the CLI bundles.

**Download source selection everywhere.** Standalone `install.sh` / `install.ps1` gain the forwarder's OSS-first selection (`PENGUIN_DOWNLOAD_SOURCE=auto|oss|github`) with immutable Release-tag stamping, so a saved versioned installer downloads exactly its matching package forever. `penguin update` adopts the same contract: OSS `latest.json` discovery with a same-tag GitHub fallback in `auto`, strict forced modes, explicit HTTPS mirror precedence, and localized failure messages.

**Compaction failures fixed — and visible.** Models that mangle the `[summary]` format no longer trap a session in a failing-compaction loop (#170): extraction applies a tolerance ladder, an unusable response retries on the standard backoff budget with a corrective note, and the burned attempts and tokens finally show up in stats and the cost center, with one shared retry-detail shape across the CLI and Web.

## Notable in this release

- **Login hardened.** The fixed `penguin-2026` seed admin password is replaced by a random one printed once at first start, and the login endpoint gains per-username exponential throttling.
- **Skills manageable in the app.** Agent settings gains a Skills tab (list from disk, uninstall, zip import/export, chat-driven install), agent-list icons deep-link to settings tabs, and the new `skill-porting` library skill brings skills in from other ecosystems; `data-analysis` moves to v2 with a leaner multi-run evaluation flow.
- **New chat defaults per Project.** Default agent, working directory, approval mode, thinking level and model, seeded into new drafts.
- **A Traces page that scales.** Shared sidebar grouping components, workspace/agent grouping, server-side session paging, and a SQLite-derived mtime-reconciled trace index replacing per-request filesystem walks.
- **Chat refinements.** The conversation outline rail windows to ±20 turns and stops overlapping the composer, the cost stat stays put across task boundaries, uploaded file attachments render as user content (and inside steering chips), tool rows drop `[failed]`-style text markers, and ANSI color no longer leaks into tool output.
- **Server IO hotspots closed.** The scheduler tick and schedules routes serve from mtime-gated caches, and `GET /messages` gains cursor pagination with tail-first web loading.
- **Dependencies.** `hono` bumped past the CORS-preflight ReDoS advisory (GHSA-8j4g-w8fx-2239); OpenRouter catalog gains `qwen/qwen3.8-max`.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.2.1/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.1).
