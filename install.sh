#!/bin/sh
# PenguinHarness one-line installer.
#
#   curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
#
# Options:
#   PENGUIN_VERSION=vX.Y.Z    choose a version (same as --version vX.Y.Z); a published Release
#                              installer defaults to its own version, an unstamped source copy to latest
#   PENGUIN_INSTALL_DIR=<dir> install dir; default ~/.penguin
#   PENGUIN_ARCHIVE=<file>    install a local Release archive without network access (same as --archive <file>)
#   PENGUIN_DOWNLOAD_SOURCE=auto|oss|github choose the online source; default auto (OSS, then same-version GitHub)
#   PENGUIN_DOWNLOAD_SPEED_PROBE=0 disable same-version OSS/GitHub probe timing in auto mode
#   PENGUIN_DOWNLOAD_BASE_URL=<url> exact online asset directory selected by the stable forwarder
#   PENGUIN_DOWNLOAD_FALLBACK_BASE_URL=<url> fallback for PENGUIN_DOWNLOAD_BASE_URL
#   --universal               install the universal package (no bundled Node runtime; needs system Node >= 24)
#
# Each Release attaches exactly one artifact per target: penguin-<target>.tar.gz, a shallow
# installer bundle holding this script, the program payload (payload.tar.gz) and the payload's
# checksum. Online installs download that bundle and verify it against its published .sha256;
# offline installs transfer the same single file, extract it once and run the bundled
# ./install.sh, which installs the sibling payload with no network access. Both paths verify
# the payload checksum sealed inside the bundle before anything is staged. Releases up to
# v0.1.5 shipped the program tree directly (top-level penguin/); such archives are still
# accepted, from --version pins and --archive files alike.
#
# The data dir (~/.penguin/data) sits under the install home but is never touched by reinstall/upgrade (which only replace bin/lib/web/node).
#
# Docs: https://penguin.ooo/docs/quickstart-cli
set -eu

REPO="https://github.com/Prism-Shadow/penguin-harness"
OSS_ORIGIN="https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com"
OSS_RELEASE_ROOT="$OSS_ORIGIN/releases"
GITHUB_RELEASE_ROOT="$REPO/releases/download"
GITHUB_LATEST_BASE="$REPO/releases/latest/download"
VERSION="${PENGUIN_VERSION:-}"
INSTALL_DIR="${PENGUIN_INSTALL_DIR:-$HOME/.penguin}"
BIN_DIR="$HOME/.local/bin"
UNIVERSAL=0
ARCHIVE="${PENGUIN_ARCHIVE:-}"
SOURCE_MODE="${PENGUIN_DOWNLOAD_SOURCE:-auto}"
DOWNLOAD_BASE_URL="${PENGUIN_DOWNLOAD_BASE_URL:-}"
DOWNLOAD_FALLBACK_BASE_URL="${PENGUIN_DOWNLOAD_FALLBACK_BASE_URL:-}"
DOWNLOAD_SPEED_PROBE="${PENGUIN_DOWNLOAD_SPEED_PROBE:-1}"
SPEED_PROBE_TOTAL_TIMEOUT_SECONDS=16
SPEED_PROBE_MANIFEST_TIMEOUT_SECONDS=5
SPEED_PROBE_SMALL_TIMEOUT_SECONDS=5
SPEED_PROBE_LARGE_TIMEOUT_SECONDS=8
SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND=262144
SPEED_PROBE_STARTED_AT=0
PAYLOAD_NAME="payload.tar.gz"
# The release workflow replaces this token with the immutable tag before publishing both the
# standalone installer and the copies sealed inside the Linux, macOS and universal bundles.
EMBEDDED_RELEASE_VERSION="__PENGUIN_RELEASE_VERSION__"

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
    v[0-9A-Za-z]* ) ;;
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

download_source_label() {
  case "$1" in
    https://*.aliyuncs.com/*) printf '%s\n' "OSS mirror" ;;
    https://github.com/*) printf '%s\n' "GitHub" ;;
    *) printf '%s\n' "configured mirror" ;;
  esac
}

# --- Parse args (also passable via curl | sh -s -- --universal) ---
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || fail "--version requires a value (e.g. --version v1.0.0)"
      VERSION="$2"
      shift 2
      ;;
    --universal)
      UNIVERSAL=1
      shift
      ;;
    --archive)
      [ $# -ge 2 ] || fail "--archive requires a path to a Release archive"
      ARCHIVE="$2"
      shift 2
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

# --- Detect platform: Linux/Darwin x64/arm64; other platforms should use the universal package ---
TARGET="universal"
if [ "$UNIVERSAL" -eq 0 ]; then
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) fail "unsupported OS: $(uname -s). Install Node.js >= 24, then re-run with --universal." ;;
  esac
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) fail "unsupported architecture: $(uname -m). Install Node.js >= 24, then re-run with --universal." ;;
  esac
  TARGET="$os-$arch"
fi
ASSET="penguin-$TARGET.tar.gz"

if [ -n "$ARCHIVE" ] && [ -n "$VERSION" ]; then
  fail "--archive/PENGUIN_ARCHIVE cannot be combined with --version/PENGUIN_VERSION"
fi
if [ -n "$VERSION" ]; then
  validate_release_tag "$VERSION"
fi
case "$SOURCE_MODE" in
  auto | oss | github) ;;
  *) fail "PENGUIN_DOWNLOAD_SOURCE must be auto, oss, or github" ;;
esac
case "$DOWNLOAD_SPEED_PROBE" in
  0 | 1) ;;
  *) fail "PENGUIN_DOWNLOAD_SPEED_PROBE must be 0 or 1" ;;
esac
RESOLVED_RELEASE_VERSION="$VERSION"
if [ -z "$RESOLVED_RELEASE_VERSION" ] && is_release_tag "$EMBEDDED_RELEASE_VERSION"; then
  RESOLVED_RELEASE_VERSION="$EMBEDDED_RELEASE_VERSION"
fi
if [ -n "$DOWNLOAD_BASE_URL" ]; then
  DOWNLOAD_BASE_URL="${DOWNLOAD_BASE_URL%/}"
  validate_https_url PENGUIN_DOWNLOAD_BASE_URL "$DOWNLOAD_BASE_URL"
  if [ -n "$DOWNLOAD_FALLBACK_BASE_URL" ]; then
    DOWNLOAD_FALLBACK_BASE_URL="${DOWNLOAD_FALLBACK_BASE_URL%/}"
    validate_https_url PENGUIN_DOWNLOAD_FALLBACK_BASE_URL "$DOWNLOAD_FALLBACK_BASE_URL"
  fi
else
  DOWNLOAD_FALLBACK_BASE_URL=""
fi

# --- Universal package precheck: system Node >= 24 (platform packages bundle the runtime, so exempt) ---
if [ "$UNIVERSAL" -eq 1 ]; then
  command -v node >/dev/null 2>&1 \
    || fail "the universal package needs Node.js >= 24 on PATH (none found)."
  node_version="$(node --version)" # e.g. v24.18.0
  v="${node_version#v}"
  major="${v%%.*}"
  if [ "$major" -lt 24 ]; then
    fail "the universal package needs Node.js >= 24, found $node_version."
  fi
fi

TMP="$(mktemp -d)"
STAGING=""
OLD_DIR=""
SWAP_ACTIVE=0
MOVED_OLD=""
MOVED_NEW=""

# Moves one directory to a new location even when the directory inode itself cannot be renamed
# — a mount point, a process's CWD, or a filesystem that pins in-use directories (overlayfs
# under Docker reports EBUSY when `penguin update` replaces the very lib/ its own process runs
# from). Strategies, in order: plain rename; per-entry renames into a fresh or existing
# destination; per-entry copy with the source entry removed (POSIX keeps an unlinked-but-open
# file valid for the process using it). A pinned, now-empty source directory is left in place
# and reused by the incoming move.
relocate_dir() {
  rl_src="$1"
  rl_dst="$2"
  if [ ! -e "$rl_dst" ] && mv "$rl_src" "$rl_dst" 2>/dev/null; then
    return 0
  fi
  [ -d "$rl_src" ] || return 1
  mkdir -p "$rl_dst" || return 1
  rl_failed=0
  for rl_entry in "$rl_src"/* "$rl_src"/.[!.]* "$rl_src"/..?*; do
    [ -e "$rl_entry" ] || [ -L "$rl_entry" ] || continue
    if ! mv "$rl_entry" "$rl_dst/" 2>/dev/null; then
      cp -Rp "$rl_entry" "$rl_dst/" || rl_failed=1
      rm -rf "$rl_entry" || rl_failed=1
    fi
  done
  [ "$rl_failed" -eq 0 ] || return 1
  [ -z "$(ls -A "$rl_src" 2>/dev/null)" ] || return 1
  rmdir "$rl_src" 2>/dev/null || :
  return 0
}

rollback_install() {
  rollback_failed=0
  for d in $MOVED_NEW; do
    # Clearing may leave a pinned-but-empty directory husk; the restore below reuses it.
    rm -rf "$INSTALL_DIR/$d" 2>/dev/null || :
    if [ -e "$INSTALL_DIR/$d" ] && [ -n "$(ls -A "$INSTALL_DIR/$d" 2>/dev/null)" ]; then
      rollback_failed=1
    fi
  done
  for d in $MOVED_OLD; do
    if [ -e "$OLD_DIR/$d" ]; then
      relocate_dir "$OLD_DIR/$d" "$INSTALL_DIR/$d" || rollback_failed=1
    fi
  done
  if [ "$rollback_failed" -ne 0 ]; then
    echo "error: automatic rollback was incomplete; previous files remain in $OLD_DIR" >&2
    return 1
  fi
  echo "Previous PenguinHarness installation restored." >&2
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ "$SWAP_ACTIVE" -eq 1 ]; then
    rollback_install
  fi
  rm -rf "$TMP"
  [ -z "$STAGING" ] || rm -rf "$STAGING"
  [ -z "$OLD_DIR" ] || rm -rf "$OLD_DIR"
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Verifies file $1 against the sha256sum-format file $2 ($3 names the layer in messages).
# Checksums are never optional: every install path either downloads the published .sha256 or
# reads the one sealed inside the bundle.
verify_sha256() {
  vs_expected="$(awk 'NR == 1 { print $1 }' "$2" | tr 'A-F' 'a-f')"
  [ -n "$vs_expected" ] || fail "checksum file is empty or malformed: $2"
  if command -v sha256sum >/dev/null 2>&1; then
    vs_actual="$(sha256sum "$1" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    vs_actual="$(shasum -a 256 "$1" | awk '{ print $1 }')"
  else
    fail "sha256sum or shasum is required for checksum verification"
  fi
  [ "$vs_actual" = "$vs_expected" ] || fail "checksum mismatch for $3."
  echo "$3 checksum OK."
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "sha256sum or shasum is required for checksum verification"
  fi
}

is_positive_integer() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    0) return 1 ;;
    *) return 0 ;;
  esac
}

speed_probe_now_seconds() {
  date +%s 2>/dev/null || printf '%s\n' 0
}

speed_probe_remaining_seconds() {
  brs_now="$(speed_probe_now_seconds)"
  case "$brs_now:$SPEED_PROBE_STARTED_AT" in
    *[!0-9:]* | :* | *:) printf '%s\n' "$SPEED_PROBE_TOTAL_TIMEOUT_SECONDS"; return 0 ;;
  esac
  brs_elapsed=$((brs_now - SPEED_PROBE_STARTED_AT))
  brs_remaining=$((SPEED_PROBE_TOTAL_TIMEOUT_SECONDS - brs_elapsed))
  if [ "$brs_remaining" -gt 0 ]; then
    printf '%s\n' "$brs_remaining"
  else
    printf '%s\n' 0
  fi
}

speed_probe_curl_timeout() {
  bct_cap="$1"
  bct_remaining="$(speed_probe_remaining_seconds)"
  [ "$bct_remaining" -gt 0 ] || return 1
  if [ "$bct_remaining" -lt "$bct_cap" ]; then
    printf '%s\n' "$bct_remaining"
  else
    printf '%s\n' "$bct_cap"
  fi
}

load_release_download_manifest() {
  lrdm_tag="$1"
  lrdm_manifest="$TMP/release-download-manifest.tsv"
  rm -f "$lrdm_manifest"
  if lrdm_timeout="$(speed_probe_curl_timeout "$SPEED_PROBE_MANIFEST_TIMEOUT_SECONDS")" \
    && curl -fsSL --connect-timeout "$lrdm_timeout" --max-time "$lrdm_timeout" "$OSS_RELEASE_ROOT/$lrdm_tag/release-download-manifest.tsv" -o "$lrdm_manifest" 2>/dev/null; then
    :
  elif lrdm_timeout="$(speed_probe_curl_timeout "$SPEED_PROBE_MANIFEST_TIMEOUT_SECONDS")" \
    && curl -fsSL --connect-timeout "$lrdm_timeout" --max-time "$lrdm_timeout" "$GITHUB_RELEASE_ROOT/$lrdm_tag/release-download-manifest.tsv" -o "$lrdm_manifest" 2>/dev/null; then
    :
  else
    return 1
  fi

  lrdm_expected_header="$(printf 'penguin-release-download-manifest\t1\t%s' "$lrdm_tag")"
  [ "$(sed -n '1p' "$lrdm_manifest")" = "$lrdm_expected_header" ] || return 1

  SPEED_PROBE_SMALL_PROBE="$(awk -F '\t' '$1 == "probe" && $2 == "small" { print $3; exit }' "$lrdm_manifest")"
  SPEED_PROBE_SMALL_SIZE="$(awk -F '\t' '$1 == "probe" && $2 == "small" { print $4; exit }' "$lrdm_manifest")"
  SPEED_PROBE_SMALL_HASH="$(awk -F '\t' '$1 == "probe" && $2 == "small" { print $5; exit }' "$lrdm_manifest")"
  SPEED_PROBE_LARGE_PROBE="$(awk -F '\t' '$1 == "probe" && $2 == "large" { print $3; exit }' "$lrdm_manifest")"
  SPEED_PROBE_LARGE_SIZE="$(awk -F '\t' '$1 == "probe" && $2 == "large" { print $4; exit }' "$lrdm_manifest")"
  SPEED_PROBE_LARGE_HASH="$(awk -F '\t' '$1 == "probe" && $2 == "large" { print $5; exit }' "$lrdm_manifest")"
  SPEED_PROBE_ASSET_SIZE="$(awk -F '\t' -v asset="$ASSET" '$1 == "asset" && $2 == asset { print $3; exit }' "$lrdm_manifest")"

  for lrdm_file in "$SPEED_PROBE_SMALL_PROBE" "$SPEED_PROBE_LARGE_PROBE"; do
    case "$lrdm_file" in
      *[!A-Za-z0-9._+-]* | *..* | '') return 1 ;;
    esac
  done
  is_positive_integer "$SPEED_PROBE_SMALL_SIZE" || return 1
  is_positive_integer "$SPEED_PROBE_LARGE_SIZE" || return 1
  is_positive_integer "$SPEED_PROBE_ASSET_SIZE" || return 1
  case "$SPEED_PROBE_SMALL_HASH:$SPEED_PROBE_LARGE_HASH" in
    *[!0-9a-f:]* | *::* | :* | *:) return 1 ;;
  esac
  [ "${#SPEED_PROBE_SMALL_HASH}" -eq 64 ] || return 1
  [ "${#SPEED_PROBE_LARGE_HASH}" -eq 64 ] || return 1
  return 0
}

probe_download_source() {
  pds_label="$1"
  pds_base="$2"
  pds_file="$3"
  pds_size="$4"
  pds_hash="$5"
  pds_metrics="$6"
  pds_timeout_cap="${7:-$SPEED_PROBE_SMALL_TIMEOUT_SECONDS}"
  pds_body="$TMP/probe-$pds_label-$pds_file"
  pds_write="$pds_metrics.tmp"
  rm -f "$pds_body" "$pds_metrics" "$pds_write"
  pds_timeout="$(speed_probe_curl_timeout "$pds_timeout_cap")" || {
    printf '%s\n' "fail" > "$pds_metrics"
    return 0
  }
  if curl -fsSL --connect-timeout "$pds_timeout" --max-time "$pds_timeout" -H "Accept-Encoding: identity" \
      -w '%{time_starttransfer} %{time_total} %{speed_download}' \
      "$pds_base/$pds_file" -o "$pds_body" > "$pds_write" 2>/dev/null; then
    pds_actual_size="$(wc -c < "$pds_body" | tr -d ' ')"
    pds_actual_hash="$(sha256_file "$pds_body" | tr 'A-F' 'a-f')"
    if [ "$pds_actual_size" = "$pds_size" ] && [ "$pds_actual_hash" = "$pds_hash" ]; then
      read pds_start pds_total pds_speed < "$pds_write" || :
      case "$pds_start:$pds_total" in
        *[!0-9.:]* | :* | *:) printf '%s\n' "fail" > "$pds_metrics" ;;
        *) printf '%s %s %s %s\n' "ok" "$pds_start" "$pds_total" "${pds_speed:-0}" > "$pds_metrics" ;;
      esac
    else
      printf '%s\n' "fail" > "$pds_metrics"
    fi
  else
    printf '%s\n' "fail" > "$pds_metrics"
  fi
}

run_probe_pair() {
  rpp_file="$1"
  rpp_size="$2"
  rpp_hash="$3"
  OSS_PROBE_METRICS="$TMP/probe-oss-$rpp_file.metrics"
  GITHUB_PROBE_METRICS="$TMP/probe-github-$rpp_file.metrics"
  probe_download_source oss "$OSS_SPEED_PROBE_BASE_URL" "$rpp_file" "$rpp_size" "$rpp_hash" "$OSS_PROBE_METRICS" &
  rpp_oss_pid=$!
  probe_download_source github "$GITHUB_SPEED_PROBE_BASE_URL" "$rpp_file" "$rpp_size" "$rpp_hash" "$GITHUB_PROBE_METRICS" &
  rpp_github_pid=$!
  wait "$rpp_oss_pid" 2>/dev/null || :
  wait "$rpp_github_pid" 2>/dev/null || :
}

probe_status() {
  ps_file="$1"
  if [ -f "$ps_file" ]; then
    awk 'NR == 1 { print $1 }' "$ps_file"
  else
    printf '%s\n' "fail"
  fi
}

select_speed_probe_source_from_metrics() {
  sfm_github_metrics="$1"
  awk -v github_min="$SPEED_PROBE_GITHUB_MIN_BYTES_PER_SECOND" '
    function read_metrics(path, out, line, fields) {
      if ((getline line < path) <= 0) return 0
      close(path)
      split(line, fields, " ")
      if (fields[1] != "ok") return 0
      out["start"] = fields[2] + 0
      out["total"] = fields[3] + 0
      out["speed"] = fields[4] + 0
      return 1
    }
    BEGIN {
      github_ok = read_metrics(ARGV[1], github)
      ARGV[1] = ""
      if (github_ok && github["speed"] >= github_min) { print "github"; exit }
      print "oss"
    }
  ' "$sfm_github_metrics"
}

speed_probe_release_sources() {
  brs_tag="$1"
  SPEED_PROBE_BASE_URL=""
  SPEED_PROBE_FALLBACK_BASE_URL=""
  OSS_SPEED_PROBE_BASE_URL="$OSS_RELEASE_ROOT/$brs_tag"
  GITHUB_SPEED_PROBE_BASE_URL="$GITHUB_RELEASE_ROOT/$brs_tag"
  SPEED_PROBE_STARTED_AT="$(speed_probe_now_seconds)"

  load_release_download_manifest "$brs_tag" || return 1
  echo "Testing OSS mirror and GitHub download sources ..."

  run_probe_pair "$SPEED_PROBE_SMALL_PROBE" "$SPEED_PROBE_SMALL_SIZE" "$SPEED_PROBE_SMALL_HASH"
  brs_oss_small="$(probe_status "$OSS_PROBE_METRICS")"
  brs_github_small="$(probe_status "$GITHUB_PROBE_METRICS")"

  if [ "$brs_oss_small" != "ok" ] && [ "$brs_github_small" = "ok" ]; then
    SPEED_PROBE_BASE_URL="$GITHUB_SPEED_PROBE_BASE_URL"
    SPEED_PROBE_FALLBACK_BASE_URL="$OSS_SPEED_PROBE_BASE_URL"
    echo "Selected GitHub (OSS mirror probe unavailable)."
    return 0
  fi
  if [ "$brs_oss_small" = "ok" ] && [ "$brs_github_small" != "ok" ]; then
    SPEED_PROBE_BASE_URL="$OSS_SPEED_PROBE_BASE_URL"
    SPEED_PROBE_FALLBACK_BASE_URL="$GITHUB_SPEED_PROBE_BASE_URL"
    echo "Selected OSS mirror (GitHub probe unavailable)."
    return 0
  fi
  if [ "$brs_oss_small" != "ok" ] && [ "$brs_github_small" != "ok" ]; then
    return 1
  fi

  if [ "$SPEED_PROBE_ASSET_SIZE" -lt 33554432 ]; then
    SPEED_PROBE_BASE_URL="$OSS_SPEED_PROBE_BASE_URL"
    SPEED_PROBE_FALLBACK_BASE_URL="$GITHUB_SPEED_PROBE_BASE_URL"
    echo "Selected OSS mirror (download source test did not need throughput probing)."
    return 0
  fi

  GITHUB_PROBE_METRICS="$TMP/probe-github-$SPEED_PROBE_LARGE_PROBE.metrics"
  probe_download_source github "$GITHUB_SPEED_PROBE_BASE_URL" "$SPEED_PROBE_LARGE_PROBE" "$SPEED_PROBE_LARGE_SIZE" "$SPEED_PROBE_LARGE_HASH" "$GITHUB_PROBE_METRICS" "$SPEED_PROBE_LARGE_TIMEOUT_SECONDS"
  brs_choice="$(select_speed_probe_source_from_metrics "$GITHUB_PROBE_METRICS")"
  if [ "$brs_choice" = "github" ]; then
    SPEED_PROBE_BASE_URL="$GITHUB_SPEED_PROBE_BASE_URL"
    SPEED_PROBE_FALLBACK_BASE_URL="$OSS_SPEED_PROBE_BASE_URL"
    echo "Selected GitHub (meets minimum download speed)."
  elif [ "$brs_choice" = "oss" ]; then
    SPEED_PROBE_BASE_URL="$OSS_SPEED_PROBE_BASE_URL"
    SPEED_PROBE_FALLBACK_BASE_URL="$GITHUB_SPEED_PROBE_BASE_URL"
    echo "Selected OSS mirror (GitHub did not meet minimum download speed)."
  else
    return 1
  fi
  return 0
}

# Downloads the bundle and its checksum as a pair. Transport failures may try a same-version
# fallback; checksum failures are handled afterwards and always abort rather than being hidden
# by a different source.
download_release_pair() {
  drp_base="$1"
  drp_label="$(download_source_label "$drp_base")"
  echo "Downloading $ASSET from $drp_label ..."
  rm -f "$ARCHIVE_PATH" "$TMP/$ASSET.sha256"
  curl -fSL --progress-bar --connect-timeout 5 --speed-limit 65536 --speed-time 20 "$drp_base/$ASSET" -o "$ARCHIVE_PATH" \
    || return 1
  curl -fsSL --connect-timeout 5 --speed-limit 1024 --speed-time 20 "$drp_base/$ASSET.sha256" -o "$TMP/$ASSET.sha256" \
    || return 1
  return 0
}

# Resolves the OSS mirror's latest immutable tag. The advertised base URL must exactly match
# the expected bucket path so metadata cannot redirect downloads to an arbitrary host.
get_oss_latest_tag() {
  gol_manifest="$1"
  rm -f "$gol_manifest"
  curl -fsSL --connect-timeout 3 --max-time 8 "$OSS_ORIGIN/latest.json" -o "$gol_manifest" 2>/dev/null \
    || return 1
  gol_schema_version="$(sed -n 's/.*"schemaVersion":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$gol_manifest" | head -n 1)"
  gol_candidate_tag="$(sed -n 's/.*"tag":[[:space:]]*"\([^"]*\)".*/\1/p' "$gol_manifest" | head -n 1)"
  gol_candidate_base="$(sed -n 's/.*"releaseBaseUrl":[[:space:]]*"\([^"]*\)".*/\1/p' "$gol_manifest" | head -n 1)"
  [ "$gol_schema_version" = "1" ] \
    && is_release_tag "$gol_candidate_tag" \
    && [ "$gol_candidate_base" = "$OSS_RELEASE_ROOT/$gol_candidate_tag" ] \
    || return 1
  printf '%s\n' "$gol_candidate_tag"
}

# --- Resolve the program payload. Three entries converge on PAYLOAD_PATH:
#     (a) bundled offline: this script sits next to payload.tar.gz in an extracted bundle;
#     (b) --archive <file>: a local installer bundle, or a payload/legacy program archive;
#     (c) online: download penguin-<target>.tar.gz and verify it, then open it.
#     A bundle is recognized by containing payload.tar.gz at its top level; anything else is a
#     program archive (payload.tar.gz itself, or a pre-0.1.6 release archive) whose top level
#     is penguin/. ---
LOCAL_ARCHIVE=0
ARCHIVE_SHAPE=""
ARCHIVE_PATH=""
ARCHIVE_NAME=""
PAYLOAD_PATH=""

# Sibling pickup engages only for a real file actually named install.sh — the name it carries
# inside a bundle. A forwarder or `curl | sh` run never satisfies that (no file, or a random
# temp name), so an online installer cannot be steered by archives someone planted next to a
# temporary script in a shared directory.
SIBLING_PAYLOAD=""
if [ -z "$ARCHIVE" ] && [ -f "$0" ] && [ "$(basename "$0")" = "install.sh" ]; then
  script_dir="$(CDPATH= cd "$(dirname "$0")" && pwd)"
  if [ -f "$script_dir/$PAYLOAD_NAME" ]; then
    SIBLING_PAYLOAD="$script_dir/$PAYLOAD_NAME"
  fi
fi

if [ -n "$SIBLING_PAYLOAD" ]; then
  # (a) Extracted bundle: install the sibling payload; no network access at all.
  [ -z "$VERSION" ] \
    || fail "--version/PENGUIN_VERSION cannot be combined with the bundled offline installer"
  echo "Using bundled payload $SIBLING_PAYLOAD ..."
  [ -f "$SIBLING_PAYLOAD.sha256" ] \
    || fail "offline checksum file not found: $SIBLING_PAYLOAD.sha256"
  verify_sha256 "$SIBLING_PAYLOAD" "$SIBLING_PAYLOAD.sha256" "Payload"
  PAYLOAD_PATH="$SIBLING_PAYLOAD"
  ARCHIVE_NAME="$PAYLOAD_NAME"
  LOCAL_ARCHIVE=1
elif [ -n "$ARCHIVE" ]; then
  # (b) Explicit local archive; its shape is probed below.
  [ -f "$ARCHIVE" ] || fail "local archive not found: $ARCHIVE"
  archive_name="${ARCHIVE##*/}"
  archive_dir="$(CDPATH= cd "$(dirname "$ARCHIVE")" && pwd)"
  ARCHIVE_PATH="$archive_dir/$archive_name"
  ARCHIVE_NAME="$archive_name"
  LOCAL_ARCHIVE=1
  echo "Using local archive $ARCHIVE_PATH ..."
else
  # (c) Online: explicit forwarder/configured URLs win. Otherwise a stamped Release installer
  #     uses its own immutable version: auto prefers OSS and falls back only to the same GitHub
  #     tag. An unstamped source-tree installer resolves latest.json first so it also locks one
  #     version before downloading assets.
  FALLBACK_BASE_URL="$DOWNLOAD_FALLBACK_BASE_URL"
  if [ -n "$DOWNLOAD_BASE_URL" ]; then
    BASE_URL="$DOWNLOAD_BASE_URL"
  elif [ "$SOURCE_MODE" = "github" ]; then
    if [ -n "$RESOLVED_RELEASE_VERSION" ]; then
      BASE_URL="$GITHUB_RELEASE_ROOT/$RESOLVED_RELEASE_VERSION"
    else
      BASE_URL="$GITHUB_LATEST_BASE"
    fi
  else
    SELECTED_TAG="$RESOLVED_RELEASE_VERSION"
    if [ -z "$SELECTED_TAG" ]; then
      SELECTED_TAG="$(get_oss_latest_tag "$TMP/latest.json" || :)"
    fi
    if [ -n "$SELECTED_TAG" ]; then
      BASE_URL="$OSS_RELEASE_ROOT/$SELECTED_TAG"
      if [ "$SOURCE_MODE" = "auto" ] && [ -z "$FALLBACK_BASE_URL" ]; then
        FALLBACK_BASE_URL="$GITHUB_RELEASE_ROOT/$SELECTED_TAG"
      fi
      if [ "$SOURCE_MODE" = "auto" ] && [ "$DOWNLOAD_SPEED_PROBE" = "1" ] && [ -z "$DOWNLOAD_BASE_URL" ]; then
        if speed_probe_release_sources "$SELECTED_TAG"; then
          BASE_URL="$SPEED_PROBE_BASE_URL"
          FALLBACK_BASE_URL="$SPEED_PROBE_FALLBACK_BASE_URL"
        else
          echo "Download source test was inconclusive; using OSS with same-version GitHub fallback."
        fi
      fi
    elif [ "$SOURCE_MODE" = "oss" ]; then
      fail "the OSS mirror is unavailable or its release metadata is invalid."
    else
      BASE_URL="$GITHUB_LATEST_BASE"
    fi
  fi
  ARCHIVE_PATH="$TMP/$ASSET"
  ARCHIVE_NAME="$ASSET"
  if ! download_release_pair "$BASE_URL"; then
    if [ -n "$FALLBACK_BASE_URL" ] && [ "$FALLBACK_BASE_URL" != "$BASE_URL" ]; then
      echo "Primary download source unavailable; trying $(download_source_label "$FALLBACK_BASE_URL") ..."
      download_release_pair "$FALLBACK_BASE_URL" \
        || fail "download failed from both the primary source and its fallback. Check your network, then retry."
    else
      fail "download failed from $(download_source_label "$BASE_URL"). Check the version tag and your network, then retry."
    fi
  fi
  verify_sha256 "$ARCHIVE_PATH" "$TMP/$ASSET.sha256" "Bundle"
fi

if [ -z "$PAYLOAD_PATH" ]; then
  if tar -tzf "$ARCHIVE_PATH" 2>/dev/null | head -50 | grep -qE "^(\./)?$PAYLOAD_NAME\$"; then
    ARCHIVE_SHAPE="bundle"
  else
    ARCHIVE_SHAPE="program"
  fi
  if [ "$ARCHIVE_SHAPE" = "bundle" ]; then
    # A local bundle is self-verifying through its sealed payload checksum; when the published
    # outer .sha256 was transferred alongside it, verify that layer too.
    if [ "$LOCAL_ARCHIVE" -eq 1 ] && [ -f "$ARCHIVE_PATH.sha256" ]; then
      verify_sha256 "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256" "Bundle"
    fi
    BUNDLE_DIR="$TMP/bundle"
    mkdir -p "$BUNDLE_DIR"
    tar -xzf "$ARCHIVE_PATH" -C "$BUNDLE_DIR"
    PAYLOAD_PATH="$BUNDLE_DIR/$PAYLOAD_NAME"
    [ -f "$PAYLOAD_PATH" ] || fail "unexpected bundle layout: $PAYLOAD_NAME missing."
    [ -f "$PAYLOAD_PATH.sha256" ] || fail "unexpected bundle layout: $PAYLOAD_NAME.sha256 missing."
    verify_sha256 "$PAYLOAD_PATH" "$PAYLOAD_PATH.sha256" "Payload"
  else
    # Program archive (payload.tar.gz, or a pre-0.1.6 release archive). A local file needs an
    # adjacent checksum — its own, or the canonical asset checksum next to a renamed legacy
    # file; an online download was already verified against the published .sha256 above.
    if [ "$LOCAL_ARCHIVE" -eq 1 ]; then
      SHA_PATH="$ARCHIVE_PATH.sha256"
      if [ ! -f "$SHA_PATH" ] && [ "$ARCHIVE_NAME" != "$ASSET" ] && [ -f "$archive_dir/$ASSET.sha256" ]; then
        SHA_PATH="$archive_dir/$ASSET.sha256"
      fi
      [ -f "$SHA_PATH" ] || fail "offline checksum file not found: $SHA_PATH"
      verify_sha256 "$ARCHIVE_PATH" "$SHA_PATH" "Payload"
    fi
    PAYLOAD_PATH="$ARCHIVE_PATH"
  fi
fi

# --- Extract and validate in staging before touching the current install. The final same-filesystem
#    swap keeps the previous dirs in .old.$$ until the installed command runs successfully; any
#    move or launch failure restores them automatically. The data dir is never part of the swap. ---
tar -xzf "$PAYLOAD_PATH" -C "$TMP"
[ -d "$TMP/penguin" ] || fail "unexpected archive layout: top-level penguin/ missing."
MANIFEST_PATH="$TMP/penguin/package-manifest.json"
if [ -f "$MANIFEST_PATH" ]; then
  manifest_target="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH" | head -n 1)"
  [ -n "$manifest_target" ] || fail "package manifest is malformed: target missing."
  [ "$manifest_target" = "$TARGET" ] \
    || fail "package target mismatch: expected $TARGET, found $manifest_target."
elif [ "$LOCAL_ARCHIVE" -eq 1 ] && [ "$ARCHIVE_SHAPE" = "program" ] && [ "$ARCHIVE_NAME" != "$ASSET" ]; then
  fail "a renamed local archive must contain package-manifest.json; use the original filename for legacy packages."
fi
mkdir -p "$INSTALL_DIR"
STAGING="$INSTALL_DIR/.staging.$$"
OLD_DIR="$INSTALL_DIR/.old.$$"
rm -rf "$STAGING"
rm -rf "$OLD_DIR"
mkdir -p "$STAGING"
for d in bin lib web node; do
  if [ -e "$TMP/penguin/$d" ]; then
    mv "$TMP/penguin/$d" "$STAGING/$d"
  fi
done
[ -x "$STAGING/bin/penguin" ] || fail "unexpected archive layout: bin/penguin missing."

# The launcher resolves lib/, web/ and node/ relative to itself, so staging is a faithful
# preflight that catches macOS execution policy and runtime/package failures before replacement.
if candidate_version="$("$STAGING/bin/penguin" --version)"; then
  [ -n "$candidate_version" ] || fail "candidate PenguinHarness returned an empty version."
else
  candidate_status=$?
  fail "candidate PenguinHarness failed to run (exit status $candidate_status). See the error above."
fi

mkdir -p "$OLD_DIR"
SWAP_ACTIVE=1
for d in bin lib web node; do
  if [ -e "$INSTALL_DIR/$d" ]; then
    if relocate_dir "$INSTALL_DIR/$d" "$OLD_DIR/$d"; then
      MOVED_OLD="$MOVED_OLD $d"
    else
      fail "could not move the existing $d directory aside (stop running penguin processes and retry); the previous installation will be restored."
    fi
  fi
done
for d in bin lib web node; do
  if [ -e "$STAGING/$d" ]; then
    if relocate_dir "$STAGING/$d" "$INSTALL_DIR/$d"; then
      MOVED_NEW="$MOVED_NEW $d"
    else
      fail "could not install the new $d directory; the previous installation will be restored."
    fi
  fi
done
[ -x "$INSTALL_DIR/bin/penguin" ] || fail "install incomplete: $INSTALL_DIR/bin/penguin missing."

# Verify again from the final path before deleting the backup. Keep stderr visible so platform
# policy, permission and runtime errors are not disguised as an "unknown" version.
if installed_version="$("$INSTALL_DIR/bin/penguin" --version)"; then
  [ -n "$installed_version" ] || fail "installed PenguinHarness returned an empty version."
else
  version_status=$?
  fail "installed PenguinHarness failed to run (exit status $version_status); the previous installation will be restored. See the error above."
fi

SWAP_ACTIVE=0
if ! rm -rf "$OLD_DIR"; then
  echo "warning: could not remove the previous installation backup at $OLD_DIR" >&2
fi
OLD_DIR=""
rm -rf "$STAGING"
STAGING=""

# --- Symlink into ~/.local/bin and check PATH only after the install is known to work. ---
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/bin/penguin" "$BIN_DIR/penguin"
PATH_MISSING=0
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) PATH_MISSING=1 ;;
esac

echo ""
echo "PenguinHarness $installed_version installed to $INSTALL_DIR"
if [ "$PATH_MISSING" -eq 1 ]; then
  echo ""
  echo "note: installation succeeded, but $BIN_DIR is not on your PATH. Add it to your shell profile:"
  case "${SHELL:-}" in
    */zsh) echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc" ;;
    */bash) echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc" ;;
    */fish) echo "  fish_add_path \$HOME/.local/bin" ;;
    *) echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
fi
echo ""
echo "Get started:"
echo "  penguin --help    # all commands"
echo "  penguin web       # start the Web UI at http://127.0.0.1:7364 (login: admin, initial password printed on first start)"
echo "  penguin server    # headless server (PORT / HOST to override)"
