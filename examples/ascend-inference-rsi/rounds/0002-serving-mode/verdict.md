# Round 0002 verdict — serving-mode switch retained

`VLLM_ASCEND_SERVING_MODE` keeps the static MTP budget that each workload needs and stays on `FULL_DECODE_ONLY`.

| Mode | Concurrency | Mean TPOT (ms) | Output throughput (tok/s) |
| --- | --- | --- | --- |
| latency (3 tokens) | 1 | 11.10 | 85.8 |
| throughput (1 token) | 32 | 26.09 | 904.7 |
| baseline (3 tokens) | 32 | 26.16 | 814.2 |

Throughput mode improves the 32-concurrency throughput by 11.1%, above the 6.66% floor, and reproduces the static one-token result. Latency mode reproduces the static three-token result and keeps single-stream TPOT at 11.10 ms.

Accuracy on the 20-question gate is 20/20 in both modes. The exact output hash is not a usable gate on this stack: two of eight prompts changed between two identical MTP-3 runs, which is the known MTP nondeterminism, not a candidate regression.

A 120-run soak at concurrency 32 completed with no failed request; median mean TPOT moved from 26.10 ms in the first 20 runs to 26.17 ms in the last 20, and throughput from 926.9 to 920.5 tok/s.

## Rejected alternatives

- Runtime dynamic speculative decoding (`num_speculative_tokens_per_batch_size`): forces `PIECEWISE` graphs and loses 5–8% at concurrency 32; with `VLLM_USE_V2_MODEL_RUNNER=1` the engine core fails to initialize.
- A static one-token default: loses 21% single-stream throughput.
- A static three-token default: leaves 11% of the high-concurrency throughput on the table.

## Status

Retained. The patch is opt-in; leaving the variable unset preserves the upstream behavior.
