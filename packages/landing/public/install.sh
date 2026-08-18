#!/bin/sh
# https://penguin.ooo/install.sh - PenguinHarness installer entry point.
#
# GitHub Pages cannot serve HTTP redirects, so this thin forwarder IS the
# stable install URL. It selects an immutable OSS release when that mirror is
# available, otherwise it falls back to GitHub, then runs the real installer
# while forwarding every argument it was given. In auto mode the script source
# does not lock the large payload source; the real versioned installer decides
# that for its own release. Usage:
#
#   curl -fsSL https://penguin.ooo/install.sh | sh
#   curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal
#
set -eu
OSS_ORIGIN="https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com"
OSS_RELEASE_ROOT="$OSS_ORIGIN/releases"
GITHUB_RELEASE_ROOT="https://github.com/Prism-Shadow/penguin-harness/releases/download"
SOURCE_MODE="${PENGUIN_DOWNLOAD_SOURCE:-auto}"

fail() {
  echo "error: $1" >&2
  exit 1
}

validate_https_url() {
  case "$2" in
    https://*) ;;
    *) fail "$1 must be an absolute HTTPS URL" ;;
  esac
}

is_release_tag() {
  case "$1" in
    v[0-9A-Za-z]*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[!0-9A-Za-z._-]*) return 1 ;;
  esac
  return 0
}

validate_release_tag() {
  is_release_tag "$1" || fail "invalid release version: $1"
}

case "$SOURCE_MODE" in
  auto | oss | github) ;;
  *) fail "PENGUIN_DOWNLOAD_SOURCE must be auto, oss, or github" ;;
esac

REQUESTED_VERSION="${PENGUIN_VERSION:-}"
expect_version=0
for arg in "$@"; do
  if [ "$expect_version" -eq 1 ]; then
    REQUESTED_VERSION="$arg"
    expect_version=0
  elif [ "$arg" = "--version" ]; then
    expect_version=1
  fi
done
[ -z "$REQUESTED_VERSION" ] || validate_release_tag "$REQUESTED_VERSION"

# Download to a file first, then run it: piping straight into `sh` would execute
# a truncated download line by line, and the real installer removes the old
# bin/lib/web/node before moving the new ones in — a cut connection mid-way
# would leave no install at all. The file lives in a private mktemp -d (0700)
# directory: the real installer picks up a payload sitting next to a script
# named install.sh (the extracted-bundle offline path), and a shared /tmp must
# never offer that seam to other local users.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
INSTALLER="$TMP_DIR/install.sh"
MANIFEST="$TMP_DIR/latest.json"
SELECTED_BASE=""
FALLBACK_BASE=""

download_installer() {
  curl -fsSL --connect-timeout 5 --max-time 30 "$1/install.sh" -o "$INSTALLER"
}

use_github() {
  if [ -n "$1" ]; then
    SELECTED_BASE="$GITHUB_RELEASE_ROOT/$1"
  else
    SELECTED_BASE="https://github.com/Prism-Shadow/penguin-harness/releases/latest/download"
  fi
  FALLBACK_BASE=""
  download_installer "$SELECTED_BASE" \
    || fail "could not download the installer from GitHub. Check your network, then retry."
}

EXPLICIT_BASE="${PENGUIN_DOWNLOAD_BASE_URL:-}"
if [ -n "$EXPLICIT_BASE" ]; then
  SELECTED_BASE="${EXPLICIT_BASE%/}"
  FALLBACK_BASE="${PENGUIN_DOWNLOAD_FALLBACK_BASE_URL:-}"
  FALLBACK_BASE="${FALLBACK_BASE%/}"
  validate_https_url PENGUIN_DOWNLOAD_BASE_URL "$SELECTED_BASE"
  [ -z "$FALLBACK_BASE" ] || validate_https_url PENGUIN_DOWNLOAD_FALLBACK_BASE_URL "$FALLBACK_BASE"
  download_installer "$SELECTED_BASE" \
    || fail "could not download the installer from the configured mirror."
elif [ "$SOURCE_MODE" = "github" ]; then
  use_github "$REQUESTED_VERSION"
else
  OSS_TAG="$REQUESTED_VERSION"
  OSS_BASE=""
  if [ -n "$OSS_TAG" ]; then
    OSS_BASE="$OSS_RELEASE_ROOT/$OSS_TAG"
  elif curl -fsSL --connect-timeout 3 --max-time 8 "$OSS_ORIGIN/latest.json" -o "$MANIFEST" 2>/dev/null; then
    schema_version="$(sed -n 's/.*"schemaVersion":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$MANIFEST" | head -n 1)"
    candidate_tag="$(sed -n 's/.*"tag":[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
    candidate_base="$(sed -n 's/.*"releaseBaseUrl":[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
    if [ "$schema_version" = "1" ] && is_release_tag "$candidate_tag"; then
      if [ "$candidate_base" = "$OSS_RELEASE_ROOT/$candidate_tag" ]; then
        OSS_TAG="$candidate_tag"
        OSS_BASE="$candidate_base"
      fi
    fi
  fi

  if [ -n "$OSS_BASE" ] && download_installer "$OSS_BASE" 2>/dev/null; then
    SELECTED_BASE="$OSS_BASE"
    if [ "$SOURCE_MODE" = "auto" ]; then
      FALLBACK_BASE="$GITHUB_RELEASE_ROOT/$OSS_TAG"
    fi
  elif [ "$SOURCE_MODE" = "oss" ]; then
    fail "the OSS mirror is unavailable or its release metadata is invalid."
  else
    use_github "$OSS_TAG"
  fi
fi

rc=0
(
  if [ -n "$EXPLICIT_BASE" ]; then
    export PENGUIN_DOWNLOAD_BASE_URL="$SELECTED_BASE"
    if [ -n "$FALLBACK_BASE" ]; then
      export PENGUIN_DOWNLOAD_FALLBACK_BASE_URL="$FALLBACK_BASE"
    else
      unset PENGUIN_DOWNLOAD_FALLBACK_BASE_URL
    fi
  else
    unset PENGUIN_DOWNLOAD_BASE_URL
    unset PENGUIN_DOWNLOAD_FALLBACK_BASE_URL
  fi
  sh "$INSTALLER" "$@"
) || rc=$?
exit "$rc"
