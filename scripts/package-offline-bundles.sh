#!/bin/sh
# Wrap each platform-specific Release archive with the matching installer and checksum.
# Relative artifact paths are resolved from the repository root.
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_INPUT="${1:-dist-artifacts}"

case "$ARTIFACT_INPUT" in
  /*) ARTIFACT_DIR="$ARTIFACT_INPUT" ;;
  *) ARTIFACT_DIR="$ROOT_DIR/$ARTIFACT_INPUT" ;;
esac

[ -d "$ARTIFACT_DIR" ] || {
  echo "error: artifact directory not found: $ARTIFACT_DIR" >&2
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
  payload="$1"
  [ -f "$ARTIFACT_DIR/$payload" ] || {
    echo "error: missing payload: $ARTIFACT_DIR/$payload" >&2
    exit 1
  }
  [ -f "$ARTIFACT_DIR/$payload.sha256" ] || {
    echo "error: missing payload checksum: $ARTIFACT_DIR/$payload.sha256" >&2
    exit 1
  }
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  payload="penguin-$target.tar.gz"
  output="$ARTIFACT_DIR/penguin-$target-offline.tar.gz"
  bundle="$WORK_DIR/$target"
  require_payload "$payload"
  mkdir -p "$bundle"
  cp "$ARTIFACT_DIR/$payload" "$ARTIFACT_DIR/$payload.sha256" "$bundle/"
  cp "$ROOT_DIR/install.sh" "$bundle/penguin-installer.sh"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' '# Offline bundle entry point. The payload path is explicit so the online installer never scans its directory.'
    printf '%s\n' 'set -eu'
    printf '%s\n' 'SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"'
    printf 'exec sh "$SCRIPT_DIR/penguin-installer.sh" --archive "$SCRIPT_DIR/%s" "$@"\n' "$payload"
  } > "$bundle/install.sh"
  chmod +x "$bundle/install.sh" "$bundle/penguin-installer.sh"
  rm -f "$output" "$output.sha256"
  tar -czf "$output" -C "$bundle" .
  write_sha256 "$output"
  echo "Created $(basename "$output")"
done

payload="penguin-win32-x64.zip"
output="$ARTIFACT_DIR/penguin-win32-x64-offline.zip"
bundle="$WORK_DIR/win32-x64"
require_payload "$payload"
mkdir -p "$bundle"
cp "$ARTIFACT_DIR/$payload" "$ARTIFACT_DIR/$payload.sha256" \
  "$ROOT_DIR/install.ps1" "$ROOT_DIR/install.cmd" "$bundle/"
rm -f "$output" "$output.sha256"
(cd "$bundle" && zip -qr "$output" .)
write_sha256 "$output"
echo "Created $(basename "$output")"
