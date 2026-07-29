#!/bin/sh
# PenguinHarness one-line installer.
#
#   curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
#
# Options:
#   PENGUIN_VERSION=vX.Y.Z    pin a version (same as --version vX.Y.Z); default is the latest Release
#   PENGUIN_INSTALL_DIR=<dir> install dir; default ~/.penguin
#   PENGUIN_ARCHIVE=<file>    install a local Release archive without network access (same as --archive <file>)
#   --universal               install the universal package (no bundled Node runtime; needs system Node >= 24)
#
# The data dir (~/.penguin/data) sits under the install home but is never touched by reinstall/upgrade (which only replace bin/lib/web/node).
#
# Docs: https://penguin.ooo/docs/installation
set -eu

REPO="https://github.com/Prism-Shadow/penguin-harness"
VERSION="${PENGUIN_VERSION:-}"
INSTALL_DIR="${PENGUIN_INSTALL_DIR:-$HOME/.penguin}"
BIN_DIR="$HOME/.local/bin"
UNIVERSAL=0
ARCHIVE="${PENGUIN_ARCHIVE:-}"

fail() {
  echo "error: $1" >&2
  exit 1
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
ASSET="penguin-universal.tar.gz"
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
  ASSET="penguin-$TARGET.tar.gz"
fi

if [ -n "$ARCHIVE" ] && [ -n "$VERSION" ]; then
  fail "--archive/PENGUIN_ARCHIVE cannot be combined with --version/PENGUIN_VERSION"
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
trap 'rm -rf "$TMP"' EXIT

# --- Resolve local/offline archive or download from GitHub. ---
LOCAL_ARCHIVE=0
HAVE_SHA=0
if [ -n "$ARCHIVE" ]; then
  [ -f "$ARCHIVE" ] || fail "local archive not found: $ARCHIVE"
  archive_name="${ARCHIVE##*/}"
  archive_dir="$(CDPATH= cd "$(dirname "$ARCHIVE")" && pwd)"
  ARCHIVE_PATH="$archive_dir/$archive_name"
  SHA_PATH="$ARCHIVE_PATH.sha256"
  if [ ! -f "$SHA_PATH" ] && [ "$archive_name" != "$ASSET" ] && [ -f "$archive_dir/$ASSET.sha256" ]; then
    SHA_PATH="$archive_dir/$ASSET.sha256"
  fi
  [ -f "$SHA_PATH" ] || fail "offline checksum file not found: $SHA_PATH"
  ARCHIVE_NAME="$archive_name"
  LOCAL_ARCHIVE=1
  HAVE_SHA=1
  echo "Using local archive $ARCHIVE_PATH ..."
else
  if [ -n "$VERSION" ]; then
    BASE_URL="$REPO/releases/download/$VERSION"
  else
    BASE_URL="$REPO/releases/latest/download"
  fi
  ARCHIVE_PATH="$TMP/$ASSET"
  SHA_PATH="$TMP/$ASSET.sha256"
  ARCHIVE_NAME="$ASSET"
  echo "Downloading $BASE_URL/$ASSET ..."
  curl -fSL --progress-bar "$BASE_URL/$ASSET" -o "$ARCHIVE_PATH" \
    || fail "download failed. Check the version tag and your network, then retry."
  if curl -fsSL "$BASE_URL/$ASSET.sha256" -o "$SHA_PATH" 2>/dev/null; then
    HAVE_SHA=1
  fi
fi

# --- SHA256 verify: mandatory offline; online keeps the existing warn-and-skip fallback. ---
if [ "$HAVE_SHA" -eq 1 ]; then
  expected="$(awk 'NR == 1 { print $1 }' "$SHA_PATH" | tr 'A-F' 'a-f')"
  [ -n "$expected" ] || fail "checksum file is empty or malformed: $SHA_PATH"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$ARCHIVE_PATH" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{ print $1 }')"
  else
    if [ "$LOCAL_ARCHIVE" -eq 1 ]; then
      fail "offline installation requires sha256sum or shasum for checksum verification"
    fi
    actual=""
    echo "warning: sha256sum/shasum not found; skipping checksum verification." >&2
  fi
  if [ -n "$actual" ]; then
    [ "$actual" = "$expected" ] || fail "checksum mismatch for $ASSET."
    echo "Checksum OK."
  fi
else
  echo "warning: checksum file not available; skipping verification." >&2
fi

# --- Extract and swap into place: first move the new dirs into a staging area inside the install
#    dir (same filesystem as the final location, so any slow cross-device copy happens before the
#    old install is touched), then swap fast (rm old + same-disk mv is a rename; tiny window).
#    No stale files after upgrade; the universal package has no node/, so cleanup lets the wrapper
#    fall back to system Node. The data dir (~/.penguin/data) is untouched. ---
tar -xzf "$ARCHIVE_PATH" -C "$TMP"
[ -d "$TMP/penguin" ] || fail "unexpected archive layout: top-level penguin/ missing."
MANIFEST_PATH="$TMP/penguin/package-manifest.json"
if [ -f "$MANIFEST_PATH" ]; then
  manifest_target="$(sed -n 's/.*"target"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH" | head -n 1)"
  [ -n "$manifest_target" ] || fail "package manifest is malformed: target missing."
  [ "$manifest_target" = "$TARGET" ] \
    || fail "package target mismatch: expected $TARGET, found $manifest_target."
elif [ "$LOCAL_ARCHIVE" -eq 1 ] && [ "$ARCHIVE_NAME" != "$ASSET" ]; then
  fail "a renamed local archive must contain package-manifest.json; use the original filename for legacy packages."
fi
mkdir -p "$INSTALL_DIR"
STAGING="$INSTALL_DIR/.staging.$$"
rm -rf "$STAGING"
mkdir -p "$STAGING"
trap 'rm -rf "$TMP" "$STAGING"' EXIT
for d in bin lib web node; do
  if [ -e "$TMP/penguin/$d" ]; then
    mv "$TMP/penguin/$d" "$STAGING/$d"
  fi
done
[ -x "$STAGING/bin/penguin" ] || fail "unexpected archive layout: bin/penguin missing."
rm -rf "$INSTALL_DIR/bin" "$INSTALL_DIR/lib" "$INSTALL_DIR/web" "$INSTALL_DIR/node"
for d in bin lib web node; do
  if [ -e "$STAGING/$d" ]; then
    mv "$STAGING/$d" "$INSTALL_DIR/$d"
  fi
done
rm -rf "$STAGING"
[ -x "$INSTALL_DIR/bin/penguin" ] || fail "install incomplete: $INSTALL_DIR/bin/penguin missing."

# --- Symlink into ~/.local/bin and check PATH ---
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/bin/penguin" "$BIN_DIR/penguin"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "note: $BIN_DIR is not on your PATH. Add it to your shell profile:"
    case "${SHELL:-}" in
      */zsh) echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc" ;;
      */bash) echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc" ;;
      */fish) echo "  fish_add_path \$HOME/.local/bin" ;;
      *) echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
    ;;
esac

# --- Finish: print version and getting-started tips ---
installed_version="$("$INSTALL_DIR/bin/penguin" --version 2>/dev/null || echo "unknown")"
echo ""
echo "PenguinHarness $installed_version installed to $INSTALL_DIR"
echo ""
echo "Get started:"
echo "  penguin --help    # all commands"
echo "  penguin web       # start the Web UI at http://127.0.0.1:7364 (initial login: admin / penguin-2026)"
echo "  penguin server    # headless server (PORT / HOST to override)"
