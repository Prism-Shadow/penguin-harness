#!/bin/sh
# Hermetic installer tests with tiny fixtures: canonical bundle layout, offline install with no
# network, POSIX upgrade rollback, and the online download flow through a stubbed curl
# (checksum layers, no-fallback failures, pre-0.1.6 legacy archives from pinned versions).
set -eu

ROOT_DIR="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
ARTIFACT_DIR="$WORK_DIR/artifacts"
PAYLOAD_DIR="$WORK_DIR/payloads"
STUB_BIN="$WORK_DIR/bin"
TEST_HOME="$WORK_DIR/home"
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
  payload="$WORK_DIR/payload-src"
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
      printf 'echo %s\n' "${4:-fixture-old}"
    } > "$payload/penguin/bin/penguin"
  fi
  chmod +x "$payload/penguin/bin/penguin"
  printf '%s\n' fixture > "$payload/penguin/lib/fixture.txt"
  mkdir -p "$payload/penguin/lib/vendor"
  printf '%s\n' vendored > "$payload/penguin/lib/vendor/data.txt"
  printf '%s\n' fixture > "$payload/penguin/web/index.html"
  printf '{"schemaVersion":1,"target":"%s"}\n' "$target" > "$payload/penguin/package-manifest.json"
  tar -czf "$output" -C "$payload" penguin
}

command -v sha256sum >/dev/null 2>&1 || fail_test "sha256sum is required"
command -v unzip >/dev/null 2>&1 || fail_test "unzip is required"
mkdir -p "$ARTIFACT_DIR" "$PAYLOAD_DIR" "$STUB_BIN" "$TEST_HOME"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64) HOST_TARGET="linux-x64" ;;
  Linux:aarch64) HOST_TARGET="linux-arm64" ;;
  Darwin:x86_64) HOST_TARGET="darwin-x64" ;;
  Darwin:arm64) HOST_TARGET="darwin-arm64" ;;
  *) fail_test "unsupported fixture platform" ;;
esac
HOST_ASSET="penguin-$HOST_TARGET.tar.gz"

# --- Build fixture payloads and package them exactly like the release workflow. ---
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64 universal; do
  make_posix_payload "$target" "$PAYLOAD_DIR/$target.tar.gz"
done
windows_payload="$WORK_DIR/windows/penguin"
mkdir -p "$windows_payload/bin"
printf '%s\r\n' '@echo off' 'echo fixture-old' > "$windows_payload/bin/penguin.cmd"
printf '%s\n' '{"schemaVersion":1,"target":"win32-x64"}' > "$windows_payload/package-manifest.json"
(cd "$WORK_DIR/windows" && zip -qr "$PAYLOAD_DIR/win32-x64.zip" penguin)

sh "$ROOT_DIR/scripts/package-release-bundles.sh" "$PAYLOAD_DIR" "$ARTIFACT_DIR"

# Exercise the exact release-workflow stamping block against new, legacy, and inconsistent tag
# sources. The workflow must keep this logic inline because it checks out the requested tag, which
# may predate any helper script added to the repository.
STAMP_SCRIPT="$WORK_DIR/stamp-release-version.sh"
awk '
  /- name: Stamp release version/ && !found { found = 1; next }
  found && /run: \|/ { in_run = 1; next }
  in_run && /^      - name:/ { exit }
  in_run { sub(/^          /, ""); print }
' "$ROOT_DIR/.github/workflows/release.yml" > "$STAMP_SCRIPT"
sed -i 's/^TAG=.*/TAG="${TEST_RELEASE_TAG:?}"/' "$STAMP_SCRIPT"
grep -q 'SH_HAS_MARKER' "$STAMP_SCRIPT" \
  || fail_test "release workflow stamping block could not be extracted"

make_stamp_case() {
  case_dir="$1"
  mkdir -p "$case_dir/packages/core/src"
  printf '%s\n' \
    'export const VERSION = "0.0.0";' \
    'export const BUILD_DATE: string | null = null;' \
    > "$case_dir/packages/core/src/index.ts"
}

STAMP_NEW_DIR="$WORK_DIR/stamp-new"
make_stamp_case "$STAMP_NEW_DIR"
printf '%s\n' 'EMBEDDED_RELEASE_VERSION="__PENGUIN_RELEASE_VERSION__"' \
  > "$STAMP_NEW_DIR/install.sh"
printf '%s\n' '$EmbeddedReleaseVersion = "__PENGUIN_RELEASE_VERSION__"' \
  > "$STAMP_NEW_DIR/install.ps1"
(cd "$STAMP_NEW_DIR" && TEST_RELEASE_TAG=v9.8.7 sh -e "$STAMP_SCRIPT")
grep -Fq 'EMBEDDED_RELEASE_VERSION="v9.8.7"' "$STAMP_NEW_DIR/install.sh" \
  || fail_test "release workflow did not stamp the POSIX installer"
grep -Fq '$EmbeddedReleaseVersion = "v9.8.7"' "$STAMP_NEW_DIR/install.ps1" \
  || fail_test "release workflow did not stamp the PowerShell installer"

STAMP_LEGACY_DIR="$WORK_DIR/stamp-legacy"
make_stamp_case "$STAMP_LEGACY_DIR"
printf '%s\n' 'legacy POSIX installer' > "$STAMP_LEGACY_DIR/install.sh"
printf '%s\n' 'legacy PowerShell installer' > "$STAMP_LEGACY_DIR/install.ps1"
(cd "$STAMP_LEGACY_DIR" && TEST_RELEASE_TAG=v9.8.7 sh -e "$STAMP_SCRIPT") \
  > "$WORK_DIR/stamp-legacy.output"
grep -Fq 'leaving installers unstamped' "$WORK_DIR/stamp-legacy.output" \
  || fail_test "release workflow did not use the legacy installer path"
grep -Fq 'legacy POSIX installer' "$STAMP_LEGACY_DIR/install.sh" \
  || fail_test "release workflow changed the legacy POSIX installer"
grep -Fq 'legacy PowerShell installer' "$STAMP_LEGACY_DIR/install.ps1" \
  || fail_test "release workflow changed the legacy PowerShell installer"

for inconsistent_side in posix powershell; do
  STAMP_INCONSISTENT_DIR="$WORK_DIR/stamp-inconsistent-$inconsistent_side"
  make_stamp_case "$STAMP_INCONSISTENT_DIR"
  printf '%s\n' 'legacy POSIX installer' > "$STAMP_INCONSISTENT_DIR/install.sh"
  printf '%s\n' 'legacy PowerShell installer' > "$STAMP_INCONSISTENT_DIR/install.ps1"
  if [ "$inconsistent_side" = posix ]; then
    printf '%s\n' 'EMBEDDED_RELEASE_VERSION="__PENGUIN_RELEASE_VERSION__"' \
      > "$STAMP_INCONSISTENT_DIR/install.sh"
  else
    printf '%s\n' '$EmbeddedReleaseVersion = "__PENGUIN_RELEASE_VERSION__"' \
      > "$STAMP_INCONSISTENT_DIR/install.ps1"
  fi
  if (cd "$STAMP_INCONSISTENT_DIR" && TEST_RELEASE_TAG=v9.8.7 sh -e "$STAMP_SCRIPT") \
    > /dev/null 2>&1; then
    fail_test "release workflow accepted inconsistent $inconsistent_side installer markers"
  fi
done

# Model the release workflow's installer stamping without changing the source installer.
STAMPED_INSTALLER="$WORK_DIR/install-v0.0.0-test.sh"
grep -q 'EMBEDDED_RELEASE_VERSION="__PENGUIN_RELEASE_VERSION__"' "$ROOT_DIR/install.sh" \
  || fail_test "POSIX installer release-version token is missing"
sed 's/__PENGUIN_RELEASE_VERSION__/v0.0.0-test/' "$ROOT_DIR/install.sh" > "$STAMPED_INSTALLER"
chmod +x "$STAMPED_INSTALLER"

# --- Canonical layout: flat bundles, exact member set, byte-identical installers, both
#     checksum layers valid. ---
for target in linux-x64 linux-arm64 darwin-x64 darwin-arm64 universal; do
  bundle="$ARTIFACT_DIR/penguin-$target.tar.gz"
  [ -f "$bundle" ] || fail_test "missing $(basename "$bundle")"
  (cd "$ARTIFACT_DIR" && sha256sum -c "$(basename "$bundle").sha256" >/dev/null) \
    || fail_test "outer checksum failed for $(basename "$bundle")"
  members="$(tar -tzf "$bundle" | sed 's#^\./##' | sed '/^$/d' | LC_ALL=C sort)"
  expected="$(printf '%s\n' install.sh payload.tar.gz payload.tar.gz.sha256 | LC_ALL=C sort)"
  [ "$members" = "$expected" ] || fail_test "$(basename "$bundle") has an unexpected layout"
  extracted="$WORK_DIR/layout-$target"
  mkdir -p "$extracted"
  tar -xzf "$bundle" -C "$extracted"
  [ -x "$extracted/install.sh" ] || fail_test "$(basename "$bundle") installer is not executable"
  cmp -s "$ROOT_DIR/install.sh" "$extracted/install.sh" \
    || fail_test "$(basename "$bundle") installer differs from the repository installer"
  (cd "$extracted" && sha256sum -c payload.tar.gz.sha256 >/dev/null) \
    || fail_test "$(basename "$bundle") payload checksum failed"
  cmp -s "$PAYLOAD_DIR/$target.tar.gz" "$extracted/payload.tar.gz" \
    || fail_test "$(basename "$bundle") payload differs from its input"
done

windows_bundle="$ARTIFACT_DIR/penguin-win32-x64.zip"
[ -f "$windows_bundle" ] || fail_test "missing penguin-win32-x64.zip"
(cd "$ARTIFACT_DIR" && sha256sum -c penguin-win32-x64.zip.sha256 >/dev/null) \
  || fail_test "outer checksum failed for penguin-win32-x64.zip"
members="$(unzip -Z1 "$windows_bundle" | LC_ALL=C sort)"
expected="$(printf '%s\n' install.cmd install.ps1 payload.zip payload.zip.sha256 | LC_ALL=C sort)"
[ "$members" = "$expected" ] || fail_test "penguin-win32-x64.zip has an unexpected layout"
extracted="$WORK_DIR/layout-win32-x64"
mkdir -p "$extracted"
(cd "$extracted" && unzip -q "$windows_bundle")
cmp -s "$ROOT_DIR/install.ps1" "$extracted/install.ps1" \
  || fail_test "Windows bundle installer differs from the repository installer"
cmp -s "$ROOT_DIR/install.cmd" "$extracted/install.cmd" \
  || fail_test "Windows bundle install.cmd differs from the repository entry point"
(cd "$extracted" && sha256sum -c payload.zip.sha256 >/dev/null) \
  || fail_test "Windows bundle payload checksum failed"
cmp -s "$PAYLOAD_DIR/win32-x64.zip" "$extracted/payload.zip" \
  || fail_test "Windows bundle payload differs from its input"

# --- Offline install: extract the bundle once and run its installer, with a curl that always
#     fails first on PATH — the offline path must never touch the network. ---
cat > "$STUB_BIN/curl" <<'EOF'
#!/bin/sh
echo "unexpected network access: curl $*" >&2
exit 7
EOF
chmod +x "$STUB_BIN/curl"

OFFLINE_DIR="$WORK_DIR/offline"
OFFLINE_INSTALL="$WORK_DIR/offline-install"
mkdir -p "$OFFLINE_DIR"
tar -xzf "$ARTIFACT_DIR/$HOST_ASSET" -C "$OFFLINE_DIR"
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$OFFLINE_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$OFFLINE_DIR/install.sh" >/dev/null \
  || fail_test "offline install from the extracted bundle failed"
[ "$("$OFFLINE_INSTALL/bin/penguin" --version)" = "fixture-old" ] \
  || fail_test "offline install did not produce a working command"

# The stamped installer inside a released bundle must still prefer its sibling payload and
# never resolve metadata or download an online asset.
STAMPED_OFFLINE_DIR="$WORK_DIR/offline-stamped"
STAMPED_OFFLINE_INSTALL="$WORK_DIR/offline-stamped-install"
mkdir -p "$STAMPED_OFFLINE_DIR"
cp "$STAMPED_INSTALLER" "$STAMPED_OFFLINE_DIR/install.sh"
cp "$OFFLINE_DIR/payload.tar.gz" "$OFFLINE_DIR/payload.tar.gz.sha256" "$STAMPED_OFFLINE_DIR/"
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$STAMPED_OFFLINE_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$STAMPED_OFFLINE_DIR/install.sh" >/dev/null \
  || fail_test "stamped offline installer unexpectedly touched the network"

# A corrupted extracted payload must be rejected by the sealed checksum.
CORRUPT_DIR="$WORK_DIR/offline-corrupt"
mkdir -p "$CORRUPT_DIR"
tar -xzf "$ARTIFACT_DIR/$HOST_ASSET" -C "$CORRUPT_DIR"
printf 'corruption' >> "$CORRUPT_DIR/payload.tar.gz"
set +e
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$WORK_DIR/offline-corrupt-install" PATH="$STUB_BIN:$PATH" \
  sh "$CORRUPT_DIR/install.sh" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail_test "corrupted offline payload was not rejected"

# --- Local archives: the canonical bundle and a bare payload both install; a failing upgrade
#     rolls back to the previous installation. ---
LOCAL_INSTALL="$TEST_HOME/.penguin"
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$LOCAL_INSTALL" \
  sh "$ROOT_DIR/install.sh" --archive "$ARTIFACT_DIR/$HOST_ASSET" >/dev/null \
  || fail_test "--archive with the canonical bundle failed"

payload_archive="$WORK_DIR/payload.tar.gz"
cp "$PAYLOAD_DIR/$HOST_TARGET.tar.gz" "$payload_archive"
write_sha256 "$payload_archive"
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$LOCAL_INSTALL" \
  sh "$ROOT_DIR/install.sh" --archive "$payload_archive" >/dev/null \
  || fail_test "--archive with a bare payload failed"

failure_archive="$WORK_DIR/final-failure.tar.gz"
make_posix_payload "$HOST_TARGET" "$failure_archive" final-failure
write_sha256 "$failure_archive"
set +e
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$LOCAL_INSTALL" \
  sh "$ROOT_DIR/install.sh" --archive "$failure_archive" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail_test "failing POSIX upgrade unexpectedly succeeded"
[ "$("$LOCAL_INSTALL/bin/penguin" --version)" = "fixture-old" ] \
  || fail_test "previous POSIX installation was not restored"

# --- Pinned-directory upgrade: emulate a filesystem that refuses to rename in-use directories
#     (overlayfs reports EBUSY when `penguin update` replaces the very lib/ its own process runs
#     from). mv/rmdir stubs refuse directory renames that touch the installed lib, forcing
#     relocate_dir through its per-entry and copy fallbacks and the husk-reuse path. ---
PINNED_LIB="$LOCAL_INSTALL/lib"
export PINNED_LIB
cat > "$STUB_BIN/mv" <<'EOF'
#!/bin/sh
if [ -d "$1" ]; then
  case "$1" in
    "$PINNED_LIB" | "$PINNED_LIB"/*)
      echo "mv: cannot move '$1': Device or resource busy" >&2
      exit 1
      ;;
  esac
fi
exec /bin/mv "$@"
EOF
cat > "$STUB_BIN/rmdir" <<'EOF'
#!/bin/sh
case "$1" in
  "$PINNED_LIB")
    echo "rmdir: failed to remove '$1': Device or resource busy" >&2
    exit 1
    ;;
esac
exec /bin/rmdir "$@"
EOF
chmod +x "$STUB_BIN/mv" "$STUB_BIN/rmdir"

pinned_archive="$WORK_DIR/pinned-upgrade.tar.gz"
make_posix_payload "$HOST_TARGET" "$pinned_archive" success fixture-upgraded
write_sha256 "$pinned_archive"
HOME="$TEST_HOME" PENGUIN_INSTALL_DIR="$LOCAL_INSTALL" PATH="$STUB_BIN:$PATH" \
  sh "$ROOT_DIR/install.sh" --archive "$pinned_archive" >/dev/null \
  || fail_test "upgrade with a pinned lib directory failed"
rm -f "$STUB_BIN/mv" "$STUB_BIN/rmdir"
[ "$("$LOCAL_INSTALL/bin/penguin" --version)" = "fixture-upgraded" ] \
  || fail_test "pinned-lib upgrade did not install the new version"
[ -f "$LOCAL_INSTALL/lib/vendor/data.txt" ] \
  || fail_test "pinned-lib upgrade lost the copied lib subdirectory"
[ -z "$(ls -A "$LOCAL_INSTALL" | grep -E '^\.(old|staging)\.' || :)" ] \
  || fail_test "pinned-lib upgrade left staging or backup directories behind"

# --- Online flow through a stubbed curl. The canonical bundle is served for current releases;
#     MODE=legacy serves a pre-0.1.6 program archive, which must still install from a pinned
#     version. Checksum failures and download failures must fail without any fallback. ---
LEGACY_ARCHIVE="$WORK_DIR/legacy.tar.gz"
make_posix_payload "$HOST_TARGET" "$LEGACY_ARCHIVE"
write_sha256 "$LEGACY_ARCHIVE"

BAD_DIR="$WORK_DIR/bad-bundle"
mkdir -p "$BAD_DIR"
tar -xzf "$ARTIFACT_DIR/$HOST_ASSET" -C "$BAD_DIR"
printf '%064d  payload.tar.gz\n' 0 > "$BAD_DIR/payload.tar.gz.sha256"
BAD_BUNDLE="$WORK_DIR/bad-bundle.tar.gz"
tar -czf "$BAD_BUNDLE" -C "$BAD_DIR" .
write_sha256 "$BAD_BUNDLE"

PROBE64="$WORK_DIR/probe-64k.bin"
PROBE1M="$WORK_DIR/probe-1m.bin"
dd if=/dev/zero of="$PROBE64" bs=65536 count=1 2>/dev/null
dd if=/dev/zero of="$PROBE1M" bs=1048576 count=1 2>/dev/null
PROBE64_HASH="$(sha256sum "$PROBE64" | awk '{ print $1 }')"
PROBE1M_HASH="$(sha256sum "$PROBE1M" | awk '{ print $1 }')"
HOST_ASSET_HASH="$(sha256sum "$ARTIFACT_DIR/$HOST_ASSET" | awk '{ print $1 }')"
BENCHMARK_ASSET_SIZE=104857600

cat > "$STUB_BIN/curl" <<'EOF'
#!/bin/sh
set -eu
output=""
url=""
writeout=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w | --write-out) writeout="$2"; shift 2 ;;
    -H | --header | --connect-timeout | --max-time | --speed-limit | --speed-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\n' "$url" >> "$REQUEST_LOG"
base="${url##*/}"
case "$MODE:$url" in
  primary-network:https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/*) exit 7 ;;
  forced-oss-payload:https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/*/penguin-*) exit 7 ;;
esac
case "$MODE:$base" in
  forwarder-auto-github:latest.json) exit 7 ;;
  forwarder-invalid-metadata:latest.json)
    printf '%s\n' '{"schemaVersion":1,"tag":"../invalid","releaseBaseUrl":"https://example.invalid"}' > "$output"
    ;;
  canonical:latest.json | outer-sha-mismatch:latest.json | inner-sha-mismatch:latest.json | forwarder-oss:latest.json | forced-oss-payload:latest.json)
    printf '%s\n' '{"schemaVersion":1,"tag":"v0.0.0-test","releaseBaseUrl":"https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test"}' > "$output"
    ;;
  benchmark-missing-manifest:release-download-manifest.tsv) exit 22 ;;
  benchmark-github-fast:release-download-manifest.tsv | benchmark-github-slightly-fast:release-download-manifest.tsv | benchmark-missing-manifest-github:release-download-manifest.tsv)
    {
      printf 'penguin-release-download-manifest\t1\tv0.0.0-test\n'
      printf 'probe\tsmall\tprobe-64k.bin\t65536\t%s\n' "$PROBE64_HASH"
      printf 'probe\tlarge\tprobe-1m.bin\t1048576\t%s\n' "$PROBE1M_HASH"
      printf 'asset\t%s\t%s\t%s\n' "$HOST_ASSET" "$BENCHMARK_ASSET_SIZE" "$HOST_ASSET_HASH"
    } > "$output"
    ;;
  benchmark-github-fast:probe-64k.bin | benchmark-github-slightly-fast:probe-64k.bin) cp "$PROBE64" "$output" ;;
  benchmark-github-fast:probe-1m.bin | benchmark-github-slightly-fast:probe-1m.bin) cp "$PROBE1M" "$output" ;;
  forwarder-oss:install.sh | forced-oss-payload:install.sh | forwarder-auto-github:install.sh | forwarder-invalid-metadata:install.sh | canonical:install.sh | benchmark-github-fast:install.sh | benchmark-github-slightly-fast:install.sh) cp "$ROOT_DIR/install.sh" "$output" ;;
  404:penguin-*) exit 22 ;;
  network:penguin-*) exit 7 ;;
  outer-sha-mismatch:penguin-*.sha256) printf '%064d  %s\n' 0 "${base%.sha256}" > "$output" ;;
  outer-sha-mismatch:penguin-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  inner-sha-mismatch:penguin-*.sha256) cp "$BAD_BUNDLE.sha256" "$output" ;;
  inner-sha-mismatch:penguin-*) cp "$BAD_BUNDLE" "$output" ;;
  benchmark-github-fast:penguin-*.sha256 | benchmark-github-slightly-fast:penguin-*.sha256 | benchmark-missing-manifest:penguin-*.sha256) cp "$ARTIFACT_DIR/$base" "$output" ;;
  benchmark-github-fast:penguin-* | benchmark-github-slightly-fast:penguin-* | benchmark-missing-manifest:penguin-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  primary-network:penguin-*.sha256) cp "$ARTIFACT_DIR/$base" "$output" ;;
  primary-network:penguin-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  forced-oss-payload:penguin-*.sha256) cp "$ARTIFACT_DIR/$base" "$output" ;;
  forced-oss-payload:penguin-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  legacy:penguin-*.sha256) cp "$LEGACY_ARCHIVE.sha256" "$output" ;;
  legacy:penguin-*) cp "$LEGACY_ARCHIVE" "$output" ;;
  canonical:penguin-*.sha256) cp "$ARTIFACT_DIR/$base" "$output" ;;
  canonical:penguin-*) cp "$ARTIFACT_DIR/$base" "$output" ;;
  *) echo "unexpected fixture request: $url" >&2; exit 2 ;;
esac
if [ -n "$writeout" ]; then
  case "$MODE:$url" in
    benchmark-github-fast:https://github.com/*/probe-1m.bin) printf '%s' '0.020 0.120 8738133' ;;
    benchmark-github-fast:*aliyuncs.com*/probe-1m.bin) printf '%s' '0.100 2.100 499321' ;;
    benchmark-github-slightly-fast:https://github.com/*/probe-1m.bin) printf '%s' '0.020 0.115 9118052' ;;
    benchmark-github-slightly-fast:*aliyuncs.com*/probe-1m.bin) printf '%s' '0.020 0.120 8738133' ;;
    benchmark-github-fast:*) printf '%s' '0.020 0.060 1092266' ;;
    *) printf '%s' '0.010 0.020 3276800' ;;
  esac
fi
EOF
chmod +x "$STUB_BIN/curl"
export ARTIFACT_DIR BAD_BUNDLE LEGACY_ARCHIVE ROOT_DIR PROBE64 PROBE1M PROBE64_HASH PROBE1M_HASH HOST_ASSET HOST_ASSET_HASH BENCHMARK_ASSET_SIZE

run_online_case() {
  name="$1"
  mode="$2"
  version="$3"
  expected="$4"
  expected_requests="$5"
  download_base_url="${6:-}"
  download_fallback_base_url="${7:-}"
  installer_path="${8:-$ROOT_DIR/install.sh}"
  source_mode="${9:-auto}"
  benchmark="${10:-0}"
  CASE_LOG="$WORK_DIR/$name.log"
  CASE_OUTPUT="$WORK_DIR/$name.output"
  CASE_INSTALL="$WORK_DIR/$name-install"
  : > "$CASE_LOG"
  set +e
  REQUEST_LOG="$CASE_LOG" MODE="$mode" PATH="$STUB_BIN:$PATH" \
    HOME="$WORK_DIR/$name-home" PENGUIN_INSTALL_DIR="$CASE_INSTALL" \
    PENGUIN_VERSION="$version" PENGUIN_DOWNLOAD_BASE_URL="$download_base_url" \
    PENGUIN_DOWNLOAD_FALLBACK_BASE_URL="$download_fallback_base_url" \
    PENGUIN_DOWNLOAD_SOURCE="$source_mode" PENGUIN_DOWNLOAD_BENCHMARK="$benchmark" \
    sh "$installer_path" >"$CASE_OUTPUT" 2>&1
  status=$?
  set -e
  if [ "$expected" = "success" ]; then
    [ "$status" -eq 0 ] || fail_test "$name unexpectedly failed"
  else
    [ "$status" -ne 0 ] || fail_test "$name unexpectedly succeeded"
  fi
  [ "$(wc -l < "$CASE_LOG" | tr -d ' ')" -eq "$expected_requests" ] \
    || fail_test "$name made an unexpected number of requests"
}

run_online_case canonical canonical "" success 3
[ "$("$WORK_DIR/canonical-install/bin/penguin" --version)" = "fixture-old" ] \
  || fail_test "canonical online install did not produce a working command"
grep -q "/latest.json\$" "$WORK_DIR/canonical.log" \
  || fail_test "unstamped installer did not resolve the OSS latest metadata"
grep -q "/releases/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/canonical.log" \
  || fail_test "unstamped installer did not lock the resolved OSS release"

run_online_case stamped canonical "" success 2 "" "" "$STAMPED_INSTALLER"
[ "$(sed -n '1p' "$WORK_DIR/stamped.log")" = \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/$HOST_ASSET" ] \
  || fail_test "stamped installer did not select its own immutable OSS release"
! grep -q "/latest.json\$" "$WORK_DIR/stamped.log" \
  || fail_test "stamped installer unexpectedly resolved latest metadata"

run_online_case stamped-fallback primary-network "" success 3 "" "" "$STAMPED_INSTALLER"
[ "$(sed -n '1p' "$WORK_DIR/stamped-fallback.log")" = \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/$HOST_ASSET" ] \
  || fail_test "stamped installer did not try its own OSS release first"
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/stamped-fallback.log" \
  || fail_test "stamped installer did not fall back to the same GitHub version"

run_online_case benchmark-github-fast benchmark-github-fast "" success 7 "" "" "$STAMPED_INSTALLER" auto 1
[ "$(grep -c "/$HOST_ASSET\$" "$WORK_DIR/benchmark-github-fast.log" | tr -d ' ')" -eq 1 ] \
  || fail_test "benchmark selected more than one primary bundle download"
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/benchmark-github-fast.log" \
  || fail_test "benchmark did not select the faster GitHub source"
run_online_case benchmark-github-slightly-fast benchmark-github-slightly-fast "" success 7 "" "" "$STAMPED_INSTALLER" auto 1
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/benchmark-github-slightly-fast.log" \
  || fail_test "benchmark did not select the shorter estimated GitHub source"

run_online_case benchmark-missing-manifest benchmark-missing-manifest "" success 4 "" "" "$STAMPED_INSTALLER" auto 1
grep -q "Download source test was inconclusive" "$WORK_DIR/benchmark-missing-manifest.output" \
  || fail_test "missing benchmark manifest did not fall back to the compatible source policy"

run_online_case stamped-github canonical "" success 2 "" "" "$STAMPED_INSTALLER" github
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/stamped-github.log" \
  || fail_test "stamped installer did not honor forced GitHub mode"
run_online_case download-base-override canonical "" success 2 \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test" ""
grep -q "OSS mirror" "$WORK_DIR/download-base-override.output" \
  || fail_test "download base override did not identify the OSS mirror"
! grep -q "aliyuncs.com" "$WORK_DIR/download-base-override.output" \
  || fail_test "download base override exposed the OSS URL in normal output"
run_online_case download-fallback primary-network "" success 3 \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test" \
  "https://github.com/Prism-Shadow/penguin-harness/releases/download/v0.0.0-test"
[ "$(sed -n '1p' "$WORK_DIR/download-fallback.log")" = \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/$HOST_ASSET" ] \
  || fail_test "download fallback did not try the primary source first"
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/download-fallback.log" \
  || fail_test "download fallback did not use the same-version GitHub source"
! grep -q "aliyuncs.com" "$WORK_DIR/download-fallback.output" \
  || fail_test "download fallback exposed the OSS URL in normal output"
run_online_case fallback-without-base primary-network "" success 3 "" \
  "https://example.invalid/releases/v0.0.0-test" "$STAMPED_INSTALLER"
! grep -q "example.invalid" "$WORK_DIR/fallback-without-base.log" \
  || fail_test "fallback without base should not override auto/source fallback"
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/fallback-without-base.log" \
  || fail_test "fallback without base did not keep the internal same-version GitHub fallback"
run_online_case outer-mismatch outer-sha-mismatch "" failure 3
run_online_case inner-mismatch inner-sha-mismatch "" failure 3
run_online_case latest-404 404 "" failure 2
run_online_case pinned-network network v0.1.4 failure 2
run_online_case pinned-legacy legacy v0.1.4 success 2
grep -q "/releases/v0.1.4/$HOST_ASSET\$" "$WORK_DIR/pinned-legacy.log" \
  || fail_test "pinned legacy did not prefer the pinned OSS asset"

# --- Stable penguin.ooo forwarder: prefer a validated immutable OSS release, but fall back to
#     GitHub when the metadata probe fails. The real installer uses a local fixture here so the
#     test isolates bootstrap routing from bundle download behavior above. ---
run_forwarder_case() {
  name="$1"
  mode="$2"
  expected_requests="$3"
  source="${4:-auto}"
  version="${5:-}"
  expected="${6:-success}"
  benchmark="${7:-0}"
  CASE_LOG="$WORK_DIR/$name.log"
  CASE_OUTPUT="$WORK_DIR/$name.output"
  CASE_INSTALL="$WORK_DIR/$name-install"
  : > "$CASE_LOG"
  if [ -n "$version" ]; then
    archive=""
  else
    archive="$ARTIFACT_DIR/$HOST_ASSET"
  fi
  set +e
  REQUEST_LOG="$CASE_LOG" MODE="$mode" PATH="$STUB_BIN:$PATH" \
    HOME="$WORK_DIR/$name-home" PENGUIN_INSTALL_DIR="$CASE_INSTALL" \
    PENGUIN_ARCHIVE="$archive" PENGUIN_VERSION="$version" \
    PENGUIN_DOWNLOAD_SOURCE="$source" PENGUIN_DOWNLOAD_BASE_URL="" \
    PENGUIN_DOWNLOAD_FALLBACK_BASE_URL="" PENGUIN_DOWNLOAD_BENCHMARK="$benchmark" \
    sh "$ROOT_DIR/packages/landing/public/install.sh" >"$CASE_OUTPUT" 2>&1
  status=$?
  set -e
  if [ "$expected" = "success" ]; then
    [ "$status" -eq 0 ] || fail_test "$name unexpectedly failed"
  else
    [ "$status" -ne 0 ] || fail_test "$name unexpectedly succeeded"
  fi
  [ "$(wc -l < "$CASE_LOG" | tr -d ' ')" -eq "$expected_requests" ] \
    || fail_test "$name made an unexpected number of requests"
  ! grep -q "aliyuncs.com" "$CASE_OUTPUT" \
    || fail_test "$name exposed the OSS URL in normal output"
}

run_forwarder_case forwarder-oss forwarder-oss 2
grep -q "/latest.json\$" "$WORK_DIR/forwarder-oss.log" \
  || fail_test "OSS forwarder did not request release metadata first"
grep -q "/releases/v0.0.0-test/install.sh\$" "$WORK_DIR/forwarder-oss.log" \
  || fail_test "OSS forwarder did not request the versioned installer"

run_forwarder_case forwarder-auto-github forwarder-auto-github 2
grep -q "github.com/.*/releases/latest/download/install.sh\$" "$WORK_DIR/forwarder-auto-github.log" \
  || fail_test "forwarder did not fall back to the GitHub installer"

run_forwarder_case forwarder-invalid-metadata forwarder-invalid-metadata 2
grep -q "github.com/.*/releases/latest/download/install.sh\$" "$WORK_DIR/forwarder-invalid-metadata.log" \
  || fail_test "invalid OSS metadata did not fall back to the GitHub installer"

run_forwarder_case forwarder-github canonical 1 github
grep -q "github.com/.*/releases/latest/download/install.sh\$" "$WORK_DIR/forwarder-github.log" \
  || fail_test "forced GitHub mode did not request the GitHub installer"

run_forwarder_case forwarder-forced-oss-no-fallback forced-oss-payload 2 oss v0.0.0-test failure
! grep -q "github.com" "$WORK_DIR/forwarder-forced-oss-no-fallback.log" \
  || fail_test "forced OSS mode unexpectedly fell back to GitHub"

run_forwarder_case forwarder-pinned canonical 3 auto v0.0.0-test
[ "$(sed -n '1p' "$WORK_DIR/forwarder-pinned.log")" = \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/install.sh" ] \
  || fail_test "pinned forwarder did not request the versioned installer"
[ "$(sed -n '2p' "$WORK_DIR/forwarder-pinned.log")" = \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/$HOST_ASSET" ] \
  || fail_test "pinned installer did not keep the selected release version"

run_forwarder_case forwarder-benchmark-handoff benchmark-github-fast 8 auto v0.0.0-test success 1
[ "$(sed -n '1p' "$WORK_DIR/forwarder-benchmark-handoff.log")" = \
  "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com/releases/v0.0.0-test/install.sh" ] \
  || fail_test "benchmark handoff forwarder did not fetch the versioned OSS installer"
grep -q "github.com/.*/releases/download/v0.0.0-test/$HOST_ASSET\$" "$WORK_DIR/forwarder-benchmark-handoff.log" \
  || fail_test "forwarder locked the payload source instead of letting the installer benchmark"

echo "Installer bundle, offline, rollback and online tests passed."
