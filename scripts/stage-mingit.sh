#!/usr/bin/env bash
# The Windows desktop and CLI installers share one unmodified MinGit distribution.
set -euo pipefail
dest="${1:?pass a MinGit destination}"
version=2.55.0.3
tag=v2.55.0.windows.3
sha=f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/git-for-windows/git/releases/download/$tag/MinGit-$version-64-bit.zip" -o "$archive"
digest=$(sha256sum "$archive")
if [[ "${digest%% *}" != "$sha" ]]; then
  echo "Wrong SHA-256 for MinGit $version" >&2
  exit 1
fi
mkdir -p "$dest"
unzip -qo "$archive" -d "$dest"
test -f "$dest/cmd/git.exe"
test -f "$dest/usr/bin/sh.exe"
test -f "$dest/etc/profile"
