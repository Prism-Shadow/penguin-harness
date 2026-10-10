#!/usr/bin/env bash
# The extension's end-to-end run: builds dist/, then loads it into Playwright's Chromium under
# Xvfb (--load-extension, --silent-debugger-extension-api).
#
#   bash packages/browser-extension/e2e/run.sh [<shots dir>]          the real chain (run.mjs)
#   bash packages/browser-extension/e2e/run.sh --stub [<shot.png>]    against a stub (run-stub.mjs)
#
# The real run starts this checkout's server (packages/server/dist, serving packages/web/dist)
# on a throwaway data root and drives the extension with this checkout's CLI
# (packages/cli/dist); it builds any of the three that is missing (SKIP_BUILD=1 never builds).
# The stub run needs neither.
#
# Needs xvfb-run, xwd (for the pictures) and Playwright's Chromium (pnpm exec playwright install
# chromium). Node >= 24: the stub server imports src/wire.ts through type stripping.
set -euo pipefail

MODE=real
if [ "${1:-}" = "--stub" ]; then
  MODE=stub
  shift
fi
OUT=${1:-}

cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"

if [ "$MODE" = "real" ] && [ "${SKIP_BUILD:-0}" != "1" ]; then
  [ -f "$ROOT/packages/server/dist/index.js" ] ||
    (cd "$ROOT" && pnpm --filter @prismshadow/penguin-core build && pnpm --filter @prismshadow/penguin-server build)
  [ -f "$ROOT/packages/cli/dist/penguin.js" ] || (cd "$ROOT" && pnpm --filter @prismshadow/penguin-cli build)
  [ -f "$ROOT/packages/web/dist/index.html" ] || (cd "$ROOT" && pnpm --filter @prismshadow/penguin-web build)
fi

node scripts/build.mjs

if [ "$MODE" = "stub" ]; then
  if [ -n "$OUT" ]; then
    E2E_SCREENSHOT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
    export E2E_SCREENSHOT
  fi
  exec xvfb-run -a -s "-screen 0 1280x860x24" node e2e/run-stub.mjs
fi

if [ -n "$OUT" ]; then
  mkdir -p "$OUT"
  E2E_SHOTS="$(cd "$OUT" && pwd)"
  export E2E_SHOTS
fi
exec xvfb-run -a -s "-screen 0 1280x860x24" node e2e/run.mjs
