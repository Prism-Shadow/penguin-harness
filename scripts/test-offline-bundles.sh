#!/bin/sh
# Smoke-test five offline wrappers and POSIX upgrade rollback with tiny fixtures.
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
ARTIFACT_DIR="$WORK_DIR/artifacts"
TEST_HOME="$WORK_DIR/home"
INSTALL_DIR="$TEST_HOME/.penguin"
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

fail_test() {
  echo "test failure: $1" >&2
  exit 1
}

write_sha256() {
  file="$1"
  (cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
}

make_posix_payload() {
  target="$1"
  output="$2"
  behavior="${3:-success}"
  payload="$WORK_DIR/payload"
  rm -rf "$payload"
  mkdir -p "$payload/penguin/bin" "$payload/penguin/lib" "$payload/penguin/web"
  if [ "$behavior" = "final-failure" ]; then
    {
      printf '%s\n' '#!/bin/sh'
      printf '%s\n' 'case "$0" in'
      printf '%s\n' '  */.staging.*/bin/penguin) echo fixture-new; exit 0 ;;'
      printf '%s\n' '  *) echo "fixture final-path failure" >&2; exit 42 ;;'
      printf '%s\n' 'esac'
    } > "$payload/penguin/bin/penguin"
  else
    {
      printf '%s\n' '#!/bin/sh'
      printf '%s\n' 'echo fixture-old'
    } > "$payload/penguin/bin/penguin"
  fi
  chmod +x "$payload/penguin/bin/penguin"
  printf '%s\n' fixture > "$payload/penguin/lib/fixture.txt"
  printf '%s\n' fixture > "$payload/penguin/web/index.html"
  printf '{"schemaVersion":1,"target":"%s"}\n' "$target" > "$payload/penguin/package-manifest.json"
  tar -czf "$output" -C "$payload" penguin
  write_sha256 "$output"
}

verify_bundle() {
  bundle="$1"
  shift
  [ -f "$bundle" ] || fail_test "missing $(basename "$bundle")"
  [ -f "$bundle.sha256" ] || fail_test "missing $(basename "$bundle").sha256"
  (cd "$(dirname "$bundle")" && sha256sum -c "$(basename "$bundle").sha256" >/dev/null)
  members="$("$@" | sed 's#^\./##' | sed '/^$/d')"
  count="$(printf '%s\n' "$members" | wc -l | tr -d ' ')"
  [ "$count" -eq 4 ] || fail_test "$(basename "$bundle") should contain exactly four files"
}

command -v sha256sum >/dev/null 2>&1 || fail_test "sha256sum is required"
command -v unzip >/dev/null 2>&1 || fail_test "unzip is required"
mkdir -p "$ARTIFACT_DIR" "$TEST_HOME"

for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  make_posix_payload "$target" "$ARTIFACT_DIR/penguin-$target.tar.gz"
done

windows_payload="$WORK_DIR/windows/penguin"
mkdir -p "$windows_payload/bin"
printf '%s\r\n' '@echo off' 'echo fixture-old' > "$windows_payload/bin/penguin.cmd"
printf '%s\n' '{"schemaVersion":1,"target":"win32-x64"}' > "$windows_payload/package-manifest.json"
(cd "$WORK_DIR/windows" && zip -qr "$ARTIFACT_DIR/penguin-win32-x64.zip" penguin)
write_sha256 "$ARTIFACT_DIR/penguin-win32-x64.zip"

sh "$ROOT_DIR/scripts/package-offline-bundles.sh" "$ARTIFACT_DIR"

for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  bundle="$ARTIFACT_DIR/penguin-$target-offline.tar.gz"
  verify_bundle "$bundle" tar -tzf "$bundle"
  tar -tzf "$bundle" | grep -q "penguin-$target.tar.gz.sha256" \
    || fail_test "$(basename "$bundle") is missing its payload checksum"
done

windows_bundle="$ARTIFACT_DIR/penguin-win32-x64-offline.zip"
verify_bundle "$windows_bundle" unzip -Z1 "$windows_bundle"
unzip -Z1 "$windows_bundle" | grep -q "penguin-win32-x64.zip.sha256" \
  || fail_test "Windows bundle is missing its payload checksum"

HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$INSTALL_DIR" \
  sh "$ROOT_DIR/install.sh" --archive "$ARTIFACT_DIR/penguin-linux-x64.tar.gz" >/dev/null

failure_archive="$WORK_DIR/final-failure.tar.gz"
make_posix_payload linux-x64 "$failure_archive" final-failure
set +e
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$INSTALL_DIR" \
  sh "$ROOT_DIR/install.sh" --archive "$failure_archive" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail_test "failing POSIX upgrade unexpectedly succeeded"
[ "$("$INSTALL_DIR/bin/penguin" --version)" = "fixture-old" ] \
  || fail_test "previous POSIX installation was not restored"

echo "Offline bundle and POSIX rollback smoke tests passed."
