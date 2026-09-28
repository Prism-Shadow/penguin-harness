# A test browser Penguin owns, installed by an admin or shipped in the release

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`, `tooling`

Added a Chromium that Penguin keeps for quality checks and tests to open an activity's player
in. Added **System settings > Test browser**, where an admin could see whether it was
installed, with its Chromium version, and install it with **Install test browser**. The page
said while the install ran, and after a failed install it named why and showed the end of the
installer's output. The Linux, macOS and Windows release packages included the browser, and
the installers put it beside the program; the universal package, the Docker image and source
installs had none, so an admin installed it there. The desktop app had no test browser, and the
page said so.

## Details

- Added `playwright-core` as a server dependency. The browser is installed into
  `PENGUIN_HOME/browsers` (Playwright's `PLAYWRIGHT_BROWSERS_PATH`), never into the user's own
  Playwright cache. When that directory had none, the server used the one named by
  `PENGUIN_BUNDLED_BROWSERS`, which both launchers set to the package's `browsers/` directory.
- Added `GET /api/admin/test-browser`, answering `{ browser: { available, installed, version,
  path, installing, error, log } }`, and `POST /api/admin/test-browser/install`, which starts
  Playwright's installer (`install --no-shell chromium`, no shell, 15-minute limit, bounded log,
  following the app proxy) and answers 202. A second install while one runs answers 409
  `test_browser_installing`. Both routes are admin only (403 `admin_required`). A failed install
  reports `error` as `failed`, `timed_out`, `not_started` or `incomplete`, with the end of its
  output in `log`.
- Added the kernel service `TestBrowser` (`status`, `install`, `executablePath`, `playUrl`).
  `playUrl` signs a link that plays an activity on the server's own loopback address. The plain
  module `activities/browser-session.ts` opens a page on such a link (`openPage`), with a
  launcher tests replace.
- `scripts/package-release-bundles.sh` installed the browser for each platform payload's target
  into `penguin/browsers/` before sealing it; the universal payload carries none.
  `PENGUIN_TEST_BROWSER_INSTALLER` replaces the installer and `PENGUIN_SKIP_TEST_BROWSER=1`
  skips the step. `install.sh` and `install.ps1` installed the payload's `browsers/` beside
  `bin/`, `lib/` and `web/` (and removed it on an upgrade to a package without one), and
  `install.ps1`'s fallback launcher set `PENGUIN_BUNDLED_BROWSERS` too.
  `scripts/test-installer.sh` checked every platform payload for its own platform's browser,
  using a stub installer, and that an install, a rollback and an upgrade left the right one.
- The server counted the browser installed only once Playwright had written its
  `INSTALLATION_COMPLETE` marker, so an install stopped part way did not count.
- The desktop app had no test browser: it bundles the server into one file and ships no
  `playwright-core` beside it. There the status answered `available: false`, the page said the
  test browser was not available in that copy of Penguin and offered no install, and
  `POST /api/admin/test-browser/install` answered 503 `test_browser_unavailable`.
