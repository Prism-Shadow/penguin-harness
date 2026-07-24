#!/usr/bin/env bash
# End-to-end verification (Playwright + mock LLM): build skills/core/server/web -> start mock Anthropic SSE ->
# start server (temp data root) -> run chat.spec.mjs. SKIP_BUILD=1 skips the build.
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
  echo "== build skills/core/server/web =="
  (cd "$ROOT" && pnpm --filter @prismshadow/penguin-skills build \
    && pnpm --filter @prismshadow/penguin-core build \
    && pnpm --filter @prismshadow/penguin-server build \
    && pnpm --filter @prismshadow/penguin-web build) || { echo "BUILD FAILED"; exit 1; }
fi

echo "== start mock LLM =="
MOCK_PORT=$MOCK_PORT node "$HERE/mock-llm.mjs" &
MOCK_PID=$!

echo "== start server =="
PENGUIN_HOME="$DATA" PORT=$SRV_PORT HOST=127.0.0.1 PENGUIN_WEB_DB="$DATA/web.db" \
  PENGUIN_WEB_DIST="$ROOT/packages/web/dist" \
  node "$ROOT/packages/server/dist/index.js" &
SRV_PID=$!

echo "== wait for server =="
for _ in $(seq 1 40); do
  curl -sf "$BASE_URL/" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "== run playwright =="
cd "$ROOT/packages/web"
npx playwright test -c "$HERE/playwright.config.mjs"
