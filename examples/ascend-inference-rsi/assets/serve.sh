#!/usr/bin/env bash
# Start the reference serving process for the Ascend inference RSI run.
set -euo pipefail

source /usr/local/Ascend/cann/set_env.sh

MODEL=${MODEL:-/workspace/shared_assets/OssSGLangMeetup/model/Qwen3.8-27B-w8a8}
PORT=${PORT:-8000}
export ASCEND_RT_VISIBLE_DEVICES=${ASCEND_RT_VISIBLE_DEVICES:-0}

if [ -n "${SPEC_SCHEDULE:-}" ]; then
  SPEC_JSON=$(printf '{"method":"qwen3_5_mtp","num_speculative_tokens":%d,"num_speculative_tokens_per_batch_size":%s}' "${SPEC_TOKENS:-3}" "$SPEC_SCHEDULE")
else
  SPEC_JSON=$(printf '{"method":"qwen3_5_mtp","num_speculative_tokens":%d}' "${SPEC_TOKENS:-3}")
fi

exec /opt/miniconda3/envs/ascend/bin/vllm serve "$MODEL" \
  --host 0.0.0.0 --port "$PORT" \
  --served-model-name qwen3.8-27b \
  --max-model-len "${MAX_MODEL_LEN:-32768}" \
  --max-num-seqs "${MAX_NUM_SEQS:-32}" \
  --quantization ascend \
  --compilation-config '{"cudagraph_mode":"FULL_DECODE_ONLY"}' \
  --speculative-config "$SPEC_JSON" \
  "$@"
