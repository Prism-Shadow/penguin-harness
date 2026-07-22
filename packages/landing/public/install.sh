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
# would leave no install at all.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
curl -fsSL "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh" -o "$TMP"
rc=0
sh "$TMP" "$@" || rc=$?
exit "$rc"
