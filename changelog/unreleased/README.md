# Unreleased

- [2026-08-04] Desktop app: new `packages/desktop` — an Electron shell that runs the existing server as a utilityProcess on the shared data root and its window on `http://localhost` with token-based no-login sign-in, graceful shutdown, and crash restart; desktop mode on the server (one-shot login, shutdown endpoint, unprinted random seed, `desktopMode`/`sessionVia` on /api/me), a new per-root `server.lock` single-instance guard the CLI and shell both honor, desktop-aware Web App chrome, and three-platform packaging (electron-builder over a pnpm-deploy staging tree, built by a reusable CI matrix ahead of Release creation; unsigned until the signing milestone). ([details](2026-08-04-desktop-app.md))

- [2026-08-04] Web App: the public fixed admin password `penguin-2026` is replaced by a random `penguin-<4 digits>` seed printed once at first start (`PENGUIN_SEED_ADMIN_PASSWORD` pins it for tests, policy-checked), and the login endpoint gains per-username exponential throttling (5 free failures, 1s doubling to 60s, `429 too_many_attempts`, reset on success, identical for unknown usernames) so the 4-digit space cannot be enumerated. ([details](2026-08-04-web-app.md))

- [2026-08-04] CLI: `penguin web` readiness-probe failures are no longer swallowed — the last error is classified (timeout / refused / reset / permission / DNS) and reported with actionable, localized guidance instead of a generic "not responding yet". ([details](2026-08-04-cli-web-probe-diagnostics.md))

- [2026-08-03] Web App: medium-width chat toolbars keep the running indicator and live statistics separate by collapsing the Agents panel and Workspace actions to accessible icon-only buttons until the large-screen breakpoint. ([details](2026-08-03-chat-toolbar-layout.md))
