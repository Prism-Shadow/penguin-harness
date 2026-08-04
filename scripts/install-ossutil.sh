#!/bin/sh
# Install a checksum-pinned ossutil 2 binary into a caller-provided directory.
# Usage: install-ossutil.sh <bin-dir>
set -eu

BIN_DIR="${1:?usage: install-ossutil.sh <bin-dir>}"
VERSION="2.3.0"
ARCHIVE="ossutil-$VERSION-linux-amd64.zip"
ARCHIVE_SHA256="3ae4d9fc85a7a6e9f5654d1599766f1a3a42a3692870887b5ae9338d582ef65a"
DOWNLOAD_URL="https://gosspublic.alicdn.com/ossutil/v2/$VERSION/$ARCHIVE"

command -v curl >/dev/null 2>&1 || {
  echo "error: curl is required" >&2
  exit 1
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "error: sha256sum is required" >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "error: unzip is required" >&2
  exit 1
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

curl --proto '=https' --tlsv1.2 -fsSL "$DOWNLOAD_URL" -o "$WORK_DIR/$ARCHIVE"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$WORK_DIR/$ARCHIVE" | sha256sum -c -
unzip -q "$WORK_DIR/$ARCHIVE" -d "$WORK_DIR/extracted"

OSSUTIL_SOURCE="$(find "$WORK_DIR/extracted" -type f -name ossutil -print -quit)"
[ -n "$OSSUTIL_SOURCE" ] || {
  echo "error: ossutil binary not found in $ARCHIVE" >&2
  exit 1
}

mkdir -p "$BIN_DIR"
install -m 0755 "$OSSUTIL_SOURCE" "$BIN_DIR/ossutil"
"$BIN_DIR/ossutil" version
