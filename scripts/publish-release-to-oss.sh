#!/bin/sh
# Mirror the exact assets downloaded from a GitHub Release into Alibaba Cloud OSS.
#
# Usage: publish-release-to-oss.sh <release-dir> <tag> [update-latest]
#   update-latest: true only when <tag> is GitHub's current latest Release.
#
# Required environment:
#   OSS_BUCKET, OSS_REGION, OSS_ENDPOINT, OSS_PUBLIC_BASE_URL and temporary
#   OSS_* credentials.
set -eu

RELEASE_DIR="${1:?usage: publish-release-to-oss.sh <release-dir> <tag> [update-latest]}"
TAG="${2:?usage: publish-release-to-oss.sh <release-dir> <tag> [update-latest]}"
UPDATE_LATEST="${3:-false}"
OSSUTIL_BIN="${OSSUTIL_BIN:-ossutil}"

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

[ -d "$RELEASE_DIR" ] || {
  echo "error: release directory not found: $RELEASE_DIR" >&2
  exit 1
}
case "$TAG" in
  v[0-9]*) VERSION="${TAG#v}" ;;
  *)
    echo "error: release tag must start with v followed by a digit: $TAG" >&2
    exit 1
    ;;
esac
case "$TAG" in
  *[!A-Za-z0-9._+-]*|*..*)
    echo "error: release tag is not safe for an OSS object prefix: $TAG" >&2
    exit 1
    ;;
esac
case "$UPDATE_LATEST" in
  true|false) ;;
  *)
    echo "error: update-latest must be true or false" >&2
    exit 1
    ;;
esac
command -v "$OSSUTIL_BIN" >/dev/null 2>&1 || {
  echo "error: ossutil not found: $OSSUTIL_BIN" >&2
  exit 1
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "error: sha256sum is required" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "error: jq is required" >&2
  exit 1
}

BUNDLES="
penguin-linux-x64.tar.gz
penguin-linux-arm64.tar.gz
penguin-darwin-x64.tar.gz
penguin-darwin-arm64.tar.gz
penguin-universal.tar.gz
penguin-win32-x64.zip
"
# Desktop installers carry version-less names (see packages/desktop/electron-builder.yml)
# and are verified as a set through SHA256SUMS.desktop instead of per-file .sha256 twins.
DESKTOP_INSTALLERS="
penguin-desktop-darwin-arm64.dmg
penguin-desktop-darwin-arm64.zip
penguin-desktop-darwin-x64.dmg
penguin-desktop-darwin-x64.zip
penguin-desktop-linux-x86_64.AppImage
penguin-desktop-linux-amd64.deb
penguin-desktop-win32-x64.exe
"
DESKTOP_UPDATE_METADATA="
latest.yml
latest-mac.yml
latest-linux.yml
"
EXPECTED_DESKTOP_UPDATE_BLOCKMAPS="
penguin-desktop-darwin-arm64.zip.blockmap
penguin-desktop-darwin-x64.zip.blockmap
penguin-desktop-win32-x64.exe.blockmap
"

if [ -f "$RELEASE_DIR/release-download-manifest.tsv" ]; then
  RELEASE_PROBES_AND_MANIFEST="
probe-64k.bin
probe-1m.bin
release-download-manifest.tsv
"
else
  if [ -f "$RELEASE_DIR/probe-64k.bin" ] || [ -f "$RELEASE_DIR/probe-1m.bin" ]; then
    echo "error: release probes are present but release-download-manifest.tsv is missing" >&2
    exit 1
  fi
  RELEASE_PROBES_AND_MANIFEST=""
  echo "No release download manifest found; mirroring legacy release assets."
fi

PRESENT_DESKTOP_UPDATE_METADATA=""
for file in $DESKTOP_UPDATE_METADATA; do
  if [ -f "$RELEASE_DIR/$file" ]; then
    PRESENT_DESKTOP_UPDATE_METADATA="$PRESENT_DESKTOP_UPDATE_METADATA
$file"
  elif [ -n "$RELEASE_PROBES_AND_MANIFEST" ]; then
    echo "error: missing desktop update metadata for release manifest contract: $file" >&2
    exit 1
  fi
done

for file in $EXPECTED_DESKTOP_UPDATE_BLOCKMAPS; do
  if [ ! -f "$RELEASE_DIR/$file" ] && [ -n "$RELEASE_PROBES_AND_MANIFEST" ]; then
    echo "error: missing desktop update blockmap for release manifest contract: $file" >&2
    exit 1
  fi
done
PRESENT_DESKTOP_UPDATE_BLOCKMAPS="$(
  for path in "$RELEASE_DIR"/*.blockmap; do
    [ -f "$path" ] || continue
    basename "$path"
  done | LC_ALL=C sort
)"

FILES="$BUNDLES
penguin-linux-x64.tar.gz.sha256
penguin-linux-arm64.tar.gz.sha256
penguin-darwin-x64.tar.gz.sha256
penguin-darwin-arm64.tar.gz.sha256
penguin-universal.tar.gz.sha256
penguin-win32-x64.zip.sha256
SHA256SUMS
$DESKTOP_INSTALLERS
$PRESENT_DESKTOP_UPDATE_METADATA
$PRESENT_DESKTOP_UPDATE_BLOCKMAPS
SHA256SUMS.desktop
$RELEASE_PROBES_AND_MANIFEST
install.sh
install.ps1
"

for file in $FILES; do
  [ -f "$RELEASE_DIR/$file" ] || {
    echo "error: missing GitHub Release asset: $file" >&2
    exit 1
  }
done

for bundle in $BUNDLES; do
  (cd "$RELEASE_DIR" && sha256sum -c "$bundle.sha256")
done
(cd "$RELEASE_DIR" && sha256sum -c SHA256SUMS)
(cd "$RELEASE_DIR" && sha256sum -c SHA256SUMS.desktop)

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

oss_cp() {
  if [ -n "$3" ]; then
    "$OSSUTIL_BIN" cp "$1" "$2" \
      --endpoint "$OSS_ENDPOINT" \
      --region "$OSS_REGION" \
      --force \
      --no-progress \
      --cache-control "$3"
  else
    "$OSSUTIL_BIN" cp "$1" "$2" \
      --endpoint "$OSS_ENDPOINT" \
      --region "$OSS_REGION" \
      --force \
      --no-progress
  fi
}

oss_put_if_absent() {
  local_file="$1"
  object_key="$2"
  cache_control="$3"

  "$OSSUTIL_BIN" api put-object \
    --bucket "$OSS_BUCKET" \
    --key "$object_key" \
    --body "file://$local_file" \
    --forbid-overwrite \
    --cache-control "$cache_control" \
    --endpoint "$OSS_ENDPOINT" \
    --region "$OSS_REGION"
}

file_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

validate_release_download_manifest() {
  manifest="$RELEASE_DIR/release-download-manifest.tsv"
  [ -f "$manifest" ] || return 0

  expected_header="$(printf 'penguin-release-download-manifest\t1\t%s' "$TAG")"
  tab="$(printf '\t')"
  line_no=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))
    if [ "$line_no" -eq 1 ]; then
      [ "$line" = "$expected_header" ] || {
        echo "error: release-download-manifest.tsv header does not match $TAG" >&2
        exit 1
      }
      continue
    fi
    [ -n "$line" ] || {
      echo "error: release-download-manifest.tsv has an empty row at line $line_no" >&2
      exit 1
    }

    old_ifs="$IFS"
    IFS="$tab"
    set -- $line
    IFS="$old_ifs"

    case "${1:-}" in
      probe)
        [ "$#" -eq 5 ] || {
          echo "error: probe row $line_no must have 5 fields" >&2
          exit 1
        }
        file="$3"
        size="$4"
        hash="$5"
        ;;
      asset|asset_checksum|desktop_asset|desktop_update_metadata|desktop_update_blockmap|desktop_checksum|installer_script)
        [ "$#" -eq 4 ] || {
          echo "error: manifest row $line_no must have 4 fields" >&2
          exit 1
        }
        file="$2"
        size="$3"
        hash="$4"
        ;;
      *)
        echo "error: unknown manifest row type at line $line_no: ${1:-}" >&2
        exit 1
        ;;
    esac

    case "$file" in
      ""|*[!A-Za-z0-9._+-]*|*..*)
        echo "error: unsafe filename in release-download-manifest.tsv line $line_no: $file" >&2
        exit 1
        ;;
    esac
    case "$size" in
      ""|*[!0-9]*)
        echo "error: invalid size in release-download-manifest.tsv line $line_no: $size" >&2
        exit 1
        ;;
    esac
    if ! [ "$size" -gt 0 ] 2>/dev/null; then
      echo "error: non-positive size in release-download-manifest.tsv line $line_no: $size" >&2
      exit 1
    fi
    case "$hash" in
      ""|*[!0-9a-f]*)
        echo "error: invalid sha256 in release-download-manifest.tsv line $line_no: $hash" >&2
        exit 1
        ;;
    esac
    [ "${#hash}" -eq 64 ] || {
      echo "error: sha256 has wrong length in release-download-manifest.tsv line $line_no" >&2
      exit 1
    }

    local_file="$RELEASE_DIR/$file"
    [ -f "$local_file" ] || {
      echo "error: manifest references missing release asset: $file" >&2
      exit 1
    }
    actual_size="$(wc -c < "$local_file" | tr -d ' ')"
    [ "$actual_size" = "$size" ] || {
      echo "error: manifest size mismatch for $file: expected $size, got $actual_size" >&2
      exit 1
    }
    actual_hash="$(file_sha256 "$local_file")"
    [ "$actual_hash" = "$hash" ] || {
      echo "error: manifest sha256 mismatch for $file" >&2
      exit 1
    }
  done < "$manifest"

  [ "$line_no" -gt 1 ] || {
    echo "error: release-download-manifest.tsv has no asset rows" >&2
    exit 1
  }
}

verify_remote_file() {
  local_file="$1"
  remote_uri="$2"
  remote_file="$WORK_DIR/remote-$(basename "$local_file")"
  rm -f "$remote_file"
  oss_cp "$remote_uri" "$remote_file" ""
  local_hash="$(file_sha256 "$local_file")"
  remote_hash="$(file_sha256 "$remote_file")"
  [ "$local_hash" = "$remote_hash" ] || {
    echo "error: OSS object differs from the GitHub Release asset: $remote_uri" >&2
    exit 1
  }
}

upload_immutable_file() {
  local_file="$1"
  object_key="$2"
  remote_uri="oss://$OSS_BUCKET/$object_key"
  existing_file="$WORK_DIR/existing-$(basename "$local_file")"
  rm -f "$existing_file"

  # An exact-key download avoids needing ListObjects. Existing identical bytes make retries
  # idempotent; different bytes fail before any upload is attempted.
  if oss_cp "$remote_uri" "$existing_file" "" >/dev/null 2>&1; then
    if [ "$(file_sha256 "$local_file")" = "$(file_sha256 "$existing_file")" ]; then
      echo "Already mirrored: $remote_uri"
      return
    fi
    echo "error: immutable OSS object already exists with different content: $remote_uri" >&2
    exit 1
  fi

  echo "Uploading: $remote_uri"
  if ! oss_put_if_absent "$local_file" "$object_key" "public,max-age=31536000,immutable"; then
    # A concurrent retry may have won the create race. It is safe only if the resulting bytes match.
    echo "Upload did not create $remote_uri; checking whether an identical object now exists."
  fi
  verify_remote_file "$local_file" "$remote_uri"
}

validate_release_download_manifest

RELEASE_PREFIX="releases/$TAG"
for file in $FILES; do
  upload_immutable_file "$RELEASE_DIR/$file" "$RELEASE_PREFIX/$file"
done

if [ "$UPDATE_LATEST" = "true" ]; then
  # Re-check at the last possible moment. Another Release can finish while this job is
  # transferring large assets; an older retry must never roll latest.json backwards.
  require_env GH_TOKEN
  require_env GITHUB_REPOSITORY
  command -v gh >/dev/null 2>&1 || {
    echo "error: gh is required when updating latest.json" >&2
    exit 1
  }
  CURRENT_LATEST_TAG="$(gh release view --repo "$GITHUB_REPOSITORY" --json tagName --jq .tagName)"
  if [ "$TAG" != "$CURRENT_LATEST_TAG" ]; then
    echo "Skipping latest.json because GitHub's latest Release changed to $CURRENT_LATEST_TAG."
    UPDATE_LATEST=false
  fi
fi

if [ "$UPDATE_LATEST" = "true" ]; then
  PUBLIC_BASE="${OSS_PUBLIC_BASE_URL%/}/$RELEASE_PREFIX"

  jq -n \
    --arg tag "$TAG" \
    --arg version "$VERSION" \
    --arg releaseBaseUrl "$PUBLIC_BASE" \
    '{
      schemaVersion: 1,
      tag: $tag,
      version: $version,
      releaseBaseUrl: $releaseBaseUrl
    }' > "$WORK_DIR/latest.json"

  LATEST_URI="oss://$OSS_BUCKET/latest.json"
  echo "Updating latest release pointer: $LATEST_URI"
  oss_cp "$WORK_DIR/latest.json" "$LATEST_URI" "no-cache"
  verify_remote_file "$WORK_DIR/latest.json" "$LATEST_URI"
else
  echo "Skipping latest.json because update-latest is false."
fi

echo "OSS mirror verified for $TAG."
