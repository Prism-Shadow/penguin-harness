#!/usr/bin/env bash
# Apply the Ascend inference RSI patch bundle to a vLLM-Ascend tree.
# Usage: ./apply.sh /path/to/vllm-ascend
set -euo pipefail

target="${1:?usage: apply.sh <vllm-ascend-tree>}"
cd "$target"

for patch in "$(dirname "$0")"/patches/*.patch; do
  echo "checking $patch"
  git apply --check "$patch"
  echo "applying $patch"
  git apply "$patch"
done

echo "applied $(ls "$(dirname "$0")"/patches/*.patch | wc -l) patch(es) to $target"
