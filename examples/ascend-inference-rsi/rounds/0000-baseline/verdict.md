# Round 0000 verdict — retained as the baseline

The five runs are stable: the coefficient of variation is 2.68% for mean TPOT and 2.22% for output throughput. The baseline is kept as the reference for every later round.

## Noise floor

`max(3%, 3 × CV)` is 8.04% for mean TPOT and 6.66% for output throughput. A candidate must beat the floor for its metric and keep the others inside their intervals.

## Configuration

Qwen3.8-27B-w8a8, TP=1 on NPU 0, 32768 context, `max-num-seqs` 32, `FULL_DECODE_ONLY`, MTP with 3 speculative tokens, random dataset, 32 prompts, 128 input and 128 output tokens, seed 0.

## Result

No candidate was measured. See `metrics.json`.
