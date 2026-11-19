#!/usr/bin/env bash
# Reverse the Ascend inference RSI patch bundle.
# Usage: ./restore.sh /path/to/vllm-ascend
set -euo pipefail

target="${1:?usage: restore.sh <vllm-ascend-tree>}"
cd "$target"

for patch in $(ls -r "$(dirname "$0")"/patches/*.patch); do
  echo "reversing $patch"
  git apply --reverse "$patch"
done

echo "restored $target"
