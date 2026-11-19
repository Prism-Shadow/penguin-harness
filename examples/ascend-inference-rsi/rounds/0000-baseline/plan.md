# Round 0000 — baseline

No change. Establish the reference numbers every later round is compared against.

## Setup

- Model: Qwen3.8-27B-w8a8.
- Serving: `assets/serve.sh` defaults — TP=1 on NPU 0, `FULL_DECODE_ONLY`, MTP speculative decoding with 3 tokens, `max-num-seqs` 32, 32768 context.
- Workload: `assets/bench.sh` with `sonnet`, 32 prompts, 128 input and 128 output tokens.

## Measurements

- Five repetitions; report the median and the 95% interval.
- TTFT p50/p90, TPOT p50/p90, output throughput, MTP acceptance.
- Profile of one decode window: host step time versus device step time, graph-capture result per batch size, top kernels.

## Acceptance

The baseline is stable when the coefficient of variation across the five runs is below the noise floor used by later rounds. If it is not, increase the repetitions or fix the environment before any candidate is measured.

## Record

Results go to `metrics.json`; the verdict goes to `verdict.md`.
