#!/bin/sh
# https://penguin.ooo/install.sh - PenguinHarness installer entry point.
#
# GitHub Pages cannot serve HTTP redirects, so this thin forwarder IS the
# stable install URL: it fetches the real installer attached to the latest
# GitHub release and runs it. Usage:
#
#   curl -fsSL https://penguin.ooo/install.sh | sh
#
set -eu
curl -fsSL "https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh" | sh
