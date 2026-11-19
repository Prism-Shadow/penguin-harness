#!/usr/bin/env bash
# Run the fixed benchmark against a running server.
set -euo pipefail

source /usr/local/Ascend/cann/set_env.sh

PORT=${PORT:-8000}
MODEL=${MODEL_NAME:-qwen3.8-27b}
MODEL_PATH=${MODEL_PATH:-/opt/models/Qwen3.8-27B-w8a8}
DATASET=${DATASET:-random}
SEED=${SEED:-0}
MAX_CONCURRENCY=${MAX_CONCURRENCY:-}
OUT=${1:-bench.json}

CONC_ARGS=()
if [ -n "$MAX_CONCURRENCY" ]; then
  CONC_ARGS=(--max-concurrency "$MAX_CONCURRENCY")
fi

if [ "$DATASET" = "sonnet" ]; then
  DATA_ARGS=(
    --dataset-name sonnet
    --dataset-path "${DATASET_PATH:-/opt/vllm/benchmarks/sonnet.txt}"
    --sonnet-input-len "${INPUT_LEN:-128}"
    --sonnet-output-len "${OUTPUT_LEN:-128}"
  )
else
  DATA_ARGS=(
    --dataset-name random
    --random-input-len "${INPUT_LEN:-128}"
    --random-output-len "${OUTPUT_LEN:-128}"
  )
fi

exec /opt/miniconda3/envs/ascend/bin/vllm bench serve \
  --backend openai-chat \
  --endpoint /v1/chat/completions \
  --model "$MODEL" \
  --tokenizer "$MODEL_PATH" \
  --host 127.0.0.1 --port "$PORT" \
  "${DATA_ARGS[@]}" \
  "${CONC_ARGS[@]}" \
  --num-prompts "${NUM_PROMPTS:-32}" \
  --seed "$SEED" \
  --percentile-metrics ttft,tpot,itl,e2el \
  --metric-percentiles 50,90,99 \
  --save-result --result-filename "$OUT"
