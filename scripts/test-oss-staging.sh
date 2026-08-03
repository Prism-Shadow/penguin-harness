#!/bin/sh
# Verify a GitHub Actions OIDC staging role can round-trip an object under staging/
# and cannot write either releases/ or the production latest.json pointer.
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

for name in OSS_BUCKET OSS_REGION OSS_ENDPOINT OSS_PUBLIC_BASE_URL; do
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
command -v curl >/dev/null 2>&1 || {
  echo "error: curl is required" >&2
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

# Probe the exact latest.json permission without risking an overwrite. The existing public
# object is used as the body and x-oss-forbid-overwrite makes the request non-destructive:
# AccessDenied is expected; FileAlreadyExists means the role was incorrectly authorized.
LATEST_COPY="$WORK_DIR/latest.json"
LATEST_URL="${OSS_PUBLIC_BASE_URL%/}/latest.json"
curl --proto '=https' --tlsv1.2 -fsSL "$LATEST_URL" -o "$LATEST_COPY"
[ -s "$LATEST_COPY" ] || {
  echo "error: downloaded latest.json is empty: $LATEST_URL" >&2
  exit 1
}

if "$OSSUTIL_BIN" api put-object \
  --bucket "$OSS_BUCKET" \
  --key latest.json \
  --body "file://$LATEST_COPY" \
  --forbid-overwrite \
  --endpoint "$OSS_ENDPOINT" \
  --region "$OSS_REGION" >"$WORK_DIR/latest-denied.log" 2>&1; then
  echo "error: staging role unexpectedly wrote the production latest.json pointer" >&2
  exit 1
fi
if grep -Eiq 'AccessDenied|Forbidden|(^|[^0-9])403([^0-9]|$)' "$WORK_DIR/latest-denied.log"; then
  echo "Production latest.json write correctly denied for the staging role."
elif grep -Eiq 'FileAlreadyExists|(^|[^0-9])409([^0-9]|$)' "$WORK_DIR/latest-denied.log"; then
  echo "error: staging role is authorized to write latest.json; overwrite was blocked by OSS" >&2
  exit 1
else
  echo "error: latest.json probe failed, but not with a recognizable access-denied response" >&2
  cat "$WORK_DIR/latest-denied.log" >&2
  exit 1
fi
