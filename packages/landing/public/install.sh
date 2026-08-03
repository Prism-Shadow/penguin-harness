#!/bin/sh
# https://penguin.ooo/install.sh - PenguinHarness installer entry point.
#
# GitHub Pages cannot serve HTTP redirects, so this thin forwarder IS the
# stable install URL: it fetches the real installer attached to the latest
# GitHub release and runs it, forwarding every argument it was given. Usage:
#
#   curl -fsSL https://penguin.ooo/install.sh | sh
#   curl -fsSL https://penguin.ooo/install.sh | sh -s -- --universal
#
set -eu
# Download to a file first, then run it: piping straight into `sh` would execute
# a truncated download line by line, and the real installer removes the old
# bin/lib/web/node before moving the new ones in — a cut connection mid-way
# would leave no install at all. The file lives in a private mktemp -d (0700)
# directory: the real installer picks up a payload sitting next to a script
# named install.sh (the extracted-bundle offline path), and a shared /tmp must
# never offer that seam to other local users.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fsSL "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh" -o "$TMP_DIR/install.sh"
rc=0
sh "$TMP_DIR/install.sh" "$@" || rc=$?
exit "$rc"
