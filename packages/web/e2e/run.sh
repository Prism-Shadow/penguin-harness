#!/usr/bin/env bash
# Build the browser/server and their dependencies, start an isolated server + mock LLM,
# then forward all arguments to Playwright. SKIP_BUILD=1 uses existing builds.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DATA="$(mktemp -d)"
LOGS="${E2E_LOG_DIR:-$ROOT/packages/web/e2e-logs}"
MOCK_PORT="${MOCK_PORT:-8931}"
SRV_PORT="${SRV_PORT:-8930}"
# localhost, not 127.0.0.1: since the Workspace-preview split the server canonicalizes the
# App onto localhost and reserves 127.0.0.1 as the preview host, where /api answers 401.
export BASE_URL="http://localhost:$SRV_PORT"
export MOCK_URL="http://127.0.0.1:$MOCK_PORT"

cleanup() {
  local status=$?
  trap - EXIT
  [ -z "${MOCK_PID:-}" ] || kill "$MOCK_PID" 2>/dev/null || true
  [ -z "${SRV_PID:-}" ] || kill "$SRV_PID" 2>/dev/null || true
  [ -z "${MOCK_PID:-}" ] || wait "$MOCK_PID" 2>/dev/null || true
  [ -z "${SRV_PID:-}" ] || wait "$SRV_PID" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    for log in "$LOGS/mock-llm.log" "$LOGS/server.log"; do
      if [ -f "$log" ]; then
        echo "== $log =="
        tail -n 100 "$log"
      fi
    done
  fi
  rm -rf "$DATA"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The mock answers GET with 404, which still proves it is listening. The app must serve 2xx.
wait_for_server() {
  local pid=$1 url=$2 require_success=$3
  local curl_args=(--noproxy '*' --silent --output /dev/null --max-time 1)
  if [ "$require_success" = "1" ]; then curl_args+=(--fail); fi
  for ((attempt=0; attempt<60; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Process exited before $url was ready" >&2
      return 1
    fi
    if curl "${curl_args[@]}" "$url"; then return 0; fi
    sleep 0.5
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== build web/server and dependencies =="
  (cd "$ROOT" \
    && pnpm --filter @prismshadow/penguin-server... \
      --filter @prismshadow/penguin-web... -r build)
fi

mkdir -p "$LOGS"
LOGS="$(cd "$LOGS" && pwd)"
echo "== start mock LLM =="
MOCK_PORT=$MOCK_PORT node "$HERE/mock-llm.mjs" >"$LOGS/mock-llm.log" 2>&1 &
MOCK_PID=$!
wait_for_server "$MOCK_PID" "$MOCK_URL/" 0

echo "== start server =="
# PENGUIN_SEED_ADMIN_PASSWORD pins the otherwise-random seeded admin password to the
# constant the specs use (ADMIN_PASSWORD in auth.mjs).
PENGUIN_HOME="$DATA" PORT=$SRV_PORT HOST=127.0.0.1 PENGUIN_WEB_DB="$DATA/web.db" \
  PENGUIN_WEB_DIST="$ROOT/packages/web/dist" \
  PENGUIN_SEED_ADMIN_PASSWORD=penguin-2026 \
  node "$ROOT/packages/server/dist/index.js" >"$LOGS/server.log" 2>&1 &
SRV_PID=$!

echo "== wait for server =="
wait_for_server "$SRV_PID" "$BASE_URL/" 1

echo "== run playwright =="
cd "$ROOT/packages/web"
pnpm exec playwright test -c "$HERE/playwright.config.mjs" "$@"
