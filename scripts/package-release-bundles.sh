#!/bin/sh
# Wrap each program payload with its checksum and native installer into the canonical Release
# artifact — the only package shape a Release publishes:
#
#   penguin-<target>.tar.gz  = install.sh + payload.tar.gz + payload.tar.gz.sha256
#   penguin-win32-x64.zip    = install.cmd + install.ps1 + payload.zip + payload.zip.sha256
#
# The same bundle serves online installs (downloaded, outer-verified and opened by install.sh /
# install.ps1) and offline installs (transfer one file, extract once, run the bundled
# installer, which verifies and installs the sibling payload with no network). The outer layer
# stays flat so extracting it never creates deep paths; only the installer expands the payload,
# inside its short staging directory.
#
# Before sealing, each platform payload gains the test browser: the Chromium that quality checks
# and tests open an activity's player in, at penguin/browsers/ (the launchers name that directory
# in PENGUIN_BUNDLED_BROWSERS, and the server uses it when its own PENGUIN_HOME/browsers has
# none). It is Playwright's own install, for the target's platform rather than this machine's.
# The universal payload names no platform, so it carries none; there an admin installs it from
# System settings. The payload file is rewritten in place, so the sealed payload stays
# byte-identical to the one in <payload-dir>.
#   PENGUIN_TEST_BROWSER_INSTALLER  a command run as `<cmd> <browsers-dir> <playwright-platform>`
#                                   instead of Playwright's installer (the tests pass a stub, so
#                                   nothing is downloaded)
#   PENGUIN_SKIP_TEST_BROWSER=1     leave the payloads as they are
#
# Usage: package-release-bundles.sh <payload-dir> [output-dir]
# <payload-dir> must contain <target>.tar.gz for linux-x64, linux-arm64, darwin-x64,
# darwin-arm64 and universal, plus win32-x64.zip; relative paths resolve from the repo root.
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
PAYLOAD_INPUT="${1:?usage: package-release-bundles.sh <payload-dir> [output-dir]}"
OUTPUT_INPUT="${2:-dist-artifacts}"

resolve_dir() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}
PAYLOAD_DIR="$(resolve_dir "$PAYLOAD_INPUT")"
OUTPUT_DIR="$(resolve_dir "$OUTPUT_INPUT")"

[ -d "$PAYLOAD_DIR" ] || {
  echo "error: payload directory not found: $PAYLOAD_DIR" >&2
  exit 1
}
command -v tar >/dev/null 2>&1 || {
  echo "error: tar is required" >&2
  exit 1
}
command -v zip >/dev/null 2>&1 || {
  echo "error: zip is required" >&2
  exit 1
}

write_sha256() {
  file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$file")" && shasum -a 256 "$(basename "$file")" > "$(basename "$file").sha256")
  else
    echo "error: sha256sum or shasum is required" >&2
    exit 1
  fi
}

require_payload() {
  [ -f "$PAYLOAD_DIR/$1" ] || {
    echo "error: missing payload: $PAYLOAD_DIR/$1" >&2
    exit 1
  }
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$OUTPUT_DIR"

# Playwright's name for the platform a payload runs on.
playwright_platform() {
  case "$1" in
    linux-x64) echo ubuntu22.04-x64 ;;
    linux-arm64) echo ubuntu22.04-arm64 ;;
    darwin-x64) echo mac14 ;;
    darwin-arm64) echo mac14-arm64 ;;
    win32-x64) echo win64 ;;
    *) return 1 ;;
  esac
}

# Playwright's installer, from the playwright-core the server depends on. --no-shell: the server
# launches the full browser by its path, so the separate headless shell would be dead weight.
install_test_browser() {
  if [ -n "${PENGUIN_TEST_BROWSER_INSTALLER:-}" ]; then
    $PENGUIN_TEST_BROWSER_INSTALLER "$1" "$2"
    return
  fi
  command -v node >/dev/null 2>&1 || {
    echo "error: node is required to install the test browser" >&2
    exit 1
  }
  itb_core="$(PENGUIN_SERVER_PACKAGE="$ROOT_DIR/packages/server/package.json" node -p \
    "require('module').createRequire(process.env.PENGUIN_SERVER_PACKAGE).resolve('playwright-core/package.json')")"
  PLAYWRIGHT_BROWSERS_PATH="$1" PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="$2" \
    node "$(dirname "$itb_core")/cli.js" install --no-shell chromium
}

# Adds penguin/browsers/ to the payload file $1 (a .tar.gz or a .zip) for target $2, in place.
add_test_browser() {
  atb_payload="$1"
  atb_target="$2"
  atb_work="$WORK_DIR/browser-$atb_target"
  rm -rf "$atb_work"
  mkdir -p "$atb_work"
  case "$atb_payload" in
    *.zip) unzip -q "$atb_payload" -d "$atb_work" ;;
    *) tar -xzf "$atb_payload" -C "$atb_work" ;;
  esac
  [ -d "$atb_work/penguin" ] || {
    echo "error: $atb_payload has no penguin/ directory" >&2
    exit 1
  }
  install_test_browser "$atb_work/penguin/browsers" "$(playwright_platform "$atb_target")"
  # Fail here rather than ship a package whose test browser silently is not there.
  ls -d "$atb_work/penguin/browsers"/chromium-* >/dev/null 2>&1 || {
    echo "error: the test browser was not installed for $atb_target" >&2
    exit 1
  }
  case "$atb_payload" in
    *.zip)
      rm -f "$atb_work/payload.zip"
      (cd "$atb_work" && zip -qr payload.zip penguin)
      mv "$atb_work/payload.zip" "$atb_payload"
      ;;
    *) tar -czf "$atb_payload" -C "$atb_work" penguin ;;
  esac
  rm -rf "$atb_work"
  echo "Added the test browser to $(basename "$atb_payload")"
}

if [ "${PENGUIN_SKIP_TEST_BROWSER:-}" != 1 ]; then
  command -v unzip >/dev/null 2>&1 || {
    echo "error: unzip is required" >&2
    exit 1
  }
  for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
    require_payload "$target.tar.gz"
    add_test_browser "$PAYLOAD_DIR/$target.tar.gz" "$target"
  done
  require_payload "win32-x64.zip"
  add_test_browser "$PAYLOAD_DIR/win32-x64.zip" win32-x64
fi

for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64 universal; do
  payload="$target.tar.gz"
  output="$OUTPUT_DIR/penguin-$target.tar.gz"
  bundle="$WORK_DIR/$target"
  require_payload "$payload"
  mkdir -p "$bundle"
  cp "$PAYLOAD_DIR/$payload" "$bundle/payload.tar.gz"
  write_sha256 "$bundle/payload.tar.gz"
  cp "$ROOT_DIR/install.sh" "$bundle/install.sh"
  chmod +x "$bundle/install.sh"
  rm -f "$output" "$output.sha256"
  tar -czf "$output" -C "$bundle" .
  write_sha256 "$output"
  echo "Created $(basename "$output")"
done

payload="win32-x64.zip"
output="$OUTPUT_DIR/penguin-win32-x64.zip"
bundle="$WORK_DIR/win32-x64"
require_payload "$payload"
mkdir -p "$bundle"
cp "$PAYLOAD_DIR/$payload" "$bundle/payload.zip"
write_sha256 "$bundle/payload.zip"
cp "$ROOT_DIR/install.ps1" "$ROOT_DIR/install.cmd" "$bundle/"
rm -f "$output" "$output.sha256"
(cd "$bundle" && zip -qr "$output" .)
write_sha256 "$output"
echo "Created $(basename "$output")"
