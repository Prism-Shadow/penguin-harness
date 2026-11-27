#!/bin/sh
# Builds node-pty's Linux terminal binding in a manylinux_2_28 container, once per
# architecture, so it loads on every Linux whose glibc runs the release's bundled Node.
#
#   sh scripts/build-linux-pty.sh <out-dir> <arch>...        arch: x64 | arm64
#
# Writes <out-dir>/linux-<arch>/pty.node for each, then checks them with
# scripts/check-native-glibc.mjs. scripts/stage-linux-pty.mjs puts them into a node-pty
# install. Needs docker, and QEMU's binfmt handler for an architecture that is not the host's
# (docker/setup-qemu-action on a runner).
#
# Why: node-pty publishes prebuilt bindings for darwin and win32 only, so on Linux it compiles
# one when it is installed, against the installing machine's glibc. The release installed it
# on `ubuntu-latest`, and when that label moved from Ubuntu 24.04 to 26.04 the binding began to
# need GLIBC_2.42 (cfsetispeed, cfsetospeed): every terminal failed on a Linux machine with an
# older glibc (issue #1900). manylinux_2_28 is AlmaLinux 8 with glibc 2.28 and a current GCC —
# the glibc nodejs.org's Linux builds of Node 24 need — so a binding built there asks nothing
# of a machine that the bundled runtime does not already ask, and a runner image change can no
# longer move it.
#
# The sources are the workspace's own node-pty and node-addon-api, the versions the lockfile
# pins, copied without their build output. Node's headers and the node-gyp that compiles come
# from the nodejs.org tarball of NODE_RUNTIME_VERSION (default: this node's version), checked
# against its SHASUMS256.txt; the binding is N-API, so one serves every Node and Electron the
# program runs under. The container runs as the calling user, so nothing it writes is root's.
set -eu

[ $# -ge 2 ] || {
  echo "usage: sh scripts/build-linux-pty.sh <out-dir> <arch>...   (arch: x64, arm64)" >&2
  exit 2
}
OUT=$1
shift
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# quay.io/pypa/manylinux_2_28_<machine>, pinned by its date tag; the floor is in the image's
# name, the tag only pins the toolchain. Bump deliberately.
MANYLINUX_TAG=2026.11.07-1
NODE_VERSION=${NODE_RUNTIME_VERSION:-$(node -p process.version)}

resolve() {
  node -p "require('path').dirname(require.resolve(process.argv[1] + '/package.json', { paths: [process.argv[2]] }))" "$1" "$2"
}
pty_dir=$(resolve node-pty "$ROOT/packages/server")
addon_dir=$(resolve node-addon-api "$pty_dir")

work=$(mktemp -d "${TMPDIR:-/tmp}/linux-pty.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/src/node_modules/node-pty" "$work/home"
cp -R "$pty_dir/package.json" "$pty_dir/binding.gyp" "$pty_dir/src" "$work/src/node_modules/node-pty/"
cp -R "$addon_dir" "$work/src/node_modules/node-addon-api"
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$work/SHASUMS256.txt"

expect=""
for arch in "$@"; do
  case $arch in
    x64) platform=linux/amd64 machine=x86_64 ;;
    arm64) platform=linux/arm64 machine=aarch64 ;;
    *)
      echo "unknown architecture: $arch (x64, arm64)" >&2
      exit 2
      ;;
  esac
  tarball="node-$NODE_VERSION-linux-$arch.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$tarball" -o "$work/$tarball"
  (cd "$work" && awk -v want="$tarball" '$2 == want' SHASUMS256.txt | grep . | sha256sum -c -)
  rm -rf "$work/node" "$work/src/node_modules/node-pty/build"
  mkdir "$work/node"
  tar -xJf "$work/$tarball" -C "$work/node" --strip-components=1
  rm -f "$work/$tarball"
  echo "Building node-pty for linux-$arch (manylinux_2_28_$machine:$MANYLINUX_TAG, Node $NODE_VERSION headers)"
  docker run --rm --platform "$platform" --user "$(id -u):$(id -g)" \
    -e HOME=/work/home -v "$work:/work" -w /work/src/node_modules/node-pty \
    "quay.io/pypa/manylinux_2_28_$machine:$MANYLINUX_TAG" \
    sh -c 'set -e
      export PATH="/work/node/bin:$PATH"
      ldd --version | head -n 1
      node /work/node/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild \
        --nodedir=/work/node --python=/opt/python/cp312-cp312/bin/python3'
  mkdir -p "$OUT/linux-$arch"
  cp "$work/src/node_modules/node-pty/build/Release/pty.node" "$OUT/linux-$arch/pty.node"
  expect="$expect --expect linux-$arch/pty.node"
done

# shellcheck disable=SC2086 # word-split on purpose: one --expect per architecture
node "$ROOT/scripts/check-native-glibc.mjs" $expect "$OUT"
