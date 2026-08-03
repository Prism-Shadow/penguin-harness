#!/bin/sh
# Verify a GitHub Actions OIDC staging role can round-trip an object under staging/
# and cannot create an object under releases/.
set -eu

OSSUTIL_BIN="${OSSUTIL_BIN:-ossutil}"
RUN_ID="${GITHUB_RUN_ID:-manual}"
RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"
PREFIX="${1:-staging/$RUN_ID-$RUN_ATTEMPT}"

require_env() {
  eval "value=\${$1:-}"
  [ -n "$value" ] || {
    echo "error: required environment variable $1 is empty" >&2
    exit 1
  }
}

for name in OSS_BUCKET OSS_REGION OSS_ENDPOINT; do
  require_env "$name"
done
case "$PREFIX" in
  staging/*) ;;
  *)
    echo "error: staging prefix must start with staging/: $PREFIX" >&2
    exit 1
    ;;
esac
command -v "$OSSUTIL_BIN" >/dev/null 2>&1 || {
  echo "error: ossutil not found: $OSSUTIL_BIN" >&2
  exit 1
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
PROBE="$WORK_DIR/oidc-probe.txt"
DOWNLOADED="$WORK_DIR/downloaded.txt"
printf 'repository=%s\nrun_id=%s\nrun_attempt=%s\ncommit=%s\n' \
  "${GITHUB_REPOSITORY:-unknown}" "$RUN_ID" "$RUN_ATTEMPT" "${GITHUB_SHA:-unknown}" > "$PROBE"

oss_cp() {
  "$OSSUTIL_BIN" cp "$1" "$2" \
    --endpoint "$OSS_ENDPOINT" \
    --region "$OSS_REGION" \
    --force \
    --no-progress
}

STAGING_URI="oss://$OSS_BUCKET/$PREFIX/oidc-probe.txt"
oss_cp "$PROBE" "$STAGING_URI"
oss_cp "$STAGING_URI" "$DOWNLOADED"
cmp "$PROBE" "$DOWNLOADED"
echo "Staging upload/download verified: $STAGING_URI"

DENIED_URI="oss://$OSS_BUCKET/releases/_staging-deny-probe/$RUN_ID-$RUN_ATTEMPT.txt"
if oss_cp "$PROBE" "$DENIED_URI" >"$WORK_DIR/denied.log" 2>&1; then
  echo "error: staging role unexpectedly wrote to production: $DENIED_URI" >&2
  echo "Remove that probe manually and fix the RAM policy before continuing." >&2
  exit 1
fi
if ! grep -Eiq 'AccessDenied|Forbidden|(^|[^0-9])403([^0-9]|$)' "$WORK_DIR/denied.log"; then
  echo "error: production probe failed, but not with a recognizable access-denied response" >&2
  cat "$WORK_DIR/denied.log" >&2
  exit 1
fi
echo "Production write correctly denied for the staging role."
