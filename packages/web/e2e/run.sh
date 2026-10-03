#!/usr/bin/env bash
# End-to-end verification (Playwright + mock LLM): build plugins/core/server/web and the
# example plugin -> seed the temp data root -> start mock Anthropic SSE -> start server (temp data
# root) -> run Playwright with the requested filters. SKIP_BUILD=1 skips the build.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DATA="$(mktemp -d)"
MOCK_PORT="${MOCK_PORT:-8931}"
SRV_PORT="${SRV_PORT:-8930}"
# localhost, not 127.0.0.1: since the Workspace-preview split the server canonicalizes the
# App onto localhost and reserves 127.0.0.1 as the preview host, where /api answers 401.
export BASE_URL="http://localhost:$SRV_PORT"
export MOCK_URL="http://127.0.0.1:$MOCK_PORT"

cleanup() {
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$DATA"
}
trap cleanup EXIT

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== build core/server/web and the example plugin =="
  (cd "$ROOT" \
    && pnpm --filter @prismshadow/penguin-core build \
    && pnpm --filter @prismshadow/penguin-server build \
    && pnpm --filter @prismshadow/penguin-web build \
    && pnpm --filter @penguinharness/example-hello-page build) || { echo "BUILD FAILED"; exit 1; }
fi

echo "== seed the data root =="
# The example plugin (plugins/example-hello-page, plugin-page.spec.mjs) is enabled for
# default_project by its built entry's absolute path — the loader's dev-checkout form. The
# server adopts an existing default_project without rewriting its plugin table, and what one
# Project lists is loaded for every user. No route can enable it instead: installing over the
# API is limited to the plugins a build ships, and this one is never shipped.
mkdir -p "$DATA/default_project"
printf '[plugins]\n"%s" = "*"\n' "$ROOT/plugins/example-hello-page/dist/index.js" \
  >"$DATA/default_project/.project_config.toml"

echo "== start mock LLM =="
MOCK_PORT=$MOCK_PORT node "$HERE/mock-llm.mjs" &
MOCK_PID=$!

echo "== start server =="
# PENGUIN_SEED_ADMIN_PASSWORD pins the otherwise-random seeded admin password to the
# constant the specs use (ADMIN_PASSWORD in auth.mjs).
PENGUIN_HOME="$DATA" PORT=$SRV_PORT HOST=127.0.0.1 PENGUIN_WEB_DB="$DATA/web.db" \
  PENGUIN_WEB_DIST="$ROOT/packages/web/dist" \
  PENGUIN_SEED_ADMIN_PASSWORD=penguin-2026 \
  node "$ROOT/packages/server/dist/index.js" &
SRV_PID=$!

echo "== wait for server =="
for _ in $(seq 1 40); do
  curl -sf "$BASE_URL/" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "== run playwright =="
cd "$ROOT/packages/web"
npx playwright test -c "$HERE/playwright.config.mjs" "$@"
