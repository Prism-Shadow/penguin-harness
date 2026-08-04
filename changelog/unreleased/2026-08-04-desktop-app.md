# Desktop app: Electron shell over the embedded server

New `packages/desktop`: a desktop distribution of the Web App that runs the existing server and frontend unchanged — an Electron shell forks `@prismshadow/penguin-server` as a utilityProcess on the shared data root and points its window at `http://localhost:<port>`, keeping the plain same-origin HTTP/SSE contract (no private IPC, no preload, no node integration in the window).

## Shell

The single-instance shell starts the server with `PORT=0`, learns the actual port from a `PENGUIN_PORT_FILE` announcement, and loads a one-shot `GET /api/auth/desktop-login?token=…` — the per-launch token (passed via `PENGUIN_DESKTOP_TOKEN`) lands the window signed in as admin with no login page. External links and Workspace previews open in the system browser. A crashed server restarts with 1s/2s/4s backoff; quitting stops it through `POST /api/desktop/shutdown` (Bearer token — the only graceful path on Windows, where killing a child is a hard terminate), falling back to kill.

## Desktop mode on the server

Desktop mode is loopback-only and adds: the one-shot login endpoint, the reusable shutdown endpoint, an `auth_sessions.via` column ("password" | "desktop", idempotent ALTER), and `desktopMode` + `sessionVia` on `GET /api/me`. The seeded admin of a desktop-created data root gets a fully random password that is never printed — sign-in goes through the shell's token — and desktop-established sessions may change the password without the old one (browser sessions against the same server still must provide it). With `PORT=0` the `::1` preview listener now reuses the actual bound port instead of grabbing a second random one.

## Single instance per data root

`web.db` is single-writer and the schedule scheduler must not run twice, so a new `<root>/server.lock` (pid + port liveness; stale locks overwritten, released on shutdown) admits one server per data root, exported side-effect-free as `@prismshadow/penguin-server/lock`. `penguin server` now refuses a busy root and prints the existing instance URL; `penguin web` opens the existing instance instead of failing; the desktop shell attaches its window to it (normal login page — the one-shot token only works against a server the shell spawned). This also removes the pre-existing hazard of two `penguin web` processes double-running the same schedules.

## Web App in desktop mode

The window hides what the shell makes meaningless: the logout entry (the window is the session), the initial-password banner (the seed is random and never shown), and the self-update entry (updates belong to the desktop app; the web self-update re-runs the CLI entry, which does not exist under the shell). The change-password dialog drops the old-password field for desktop sessions.

## Packaging (three platforms)

electron-builder produces macOS dmg + zip (arm64/x64), Windows NSIS and Linux AppImage + deb from a `pnpm deploy --prod` staging tree — a portable node_modules with the workspace packages materialized and the web build placed in the server package's npm layout; asar is off on purpose (the shell forks the server, the skill library reads its files from disk, agent commands spawn real shells). Windows carries the same pinned MinGit as the CLI zip and advertises it as `PENGUIN_BUNDLED_SHELL`. A reusable `desktop-build.yml` three-OS matrix (with `workflow_dispatch` dry runs) runs inside `release.yml` BEFORE the Release is created — assets are immutable at publish — attaching the installers plus `SHA256SUMS.desktop`. M3 artifacts are unsigned; signing, notarization, icons and electron-updater are the next milestone. Dev quality-of-life: root `pnpm desktop` builds everything and starts the shell on the dev data root, and a preflight turns the stale-injected-copy `ERR_MODULE_NOT_FOUND` into an actionable message.

## Fixes

Both Workspace HTML preview entry points were dead in the desktop app and now work. The preview redirect resolved to port `0` — preview URLs are built from the server's own bind port (deliberately, since dev serves the SPA on a different port) while the shell starts the server with `PORT=0` — producing a `http://127.0.0.1:0/…` address browsers reject as an unsafe port; the actual bound port is now written back once listening, and an unknown port degrades to the sandboxed same-origin preview instead of an unloadable URL. "Open in a new tab" silently did nothing, because the link is app-origin and the shell denied every popup while only forwarding external URLs to the system browser — where the cookie-gated redirect would 401 anyway; app-origin popups now open a Node-free child window that follows the redirect and may navigate this instance's loopback surface, with anything else still going outward. Separately, the desktop shell's process credentials (`PENGUIN_DESKTOP_TOKEN`, `PENGUIN_PORT_FILE`) and the pinned seed password no longer leak into Agent command environments.
