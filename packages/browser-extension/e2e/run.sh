#!/usr/bin/env bash
# The extension's end-to-end run: builds dist/, then loads it into Playwright's Chromium under
# Xvfb (--load-extension, --silent-debugger-extension-api) and drives it from a stub server.
#
#   bash packages/browser-extension/e2e/run.sh [screenshot.png]
#
# Needs xvfb-run, xwd (for the screenshot) and Playwright's Chromium (pnpm exec playwright
# install chromium). Node >= 24: the stub server imports src/wire.ts through type stripping.
set -euo pipefail

if [ -n "${1:-}" ]; then
  E2E_SCREENSHOT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  export E2E_SCREENSHOT
fi
cd "$(dirname "$0")/.."
node scripts/build.mjs
exec xvfb-run -a -s "-screen 0 1280x860x24" node e2e/run.mjs
