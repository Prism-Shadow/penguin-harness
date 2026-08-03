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
