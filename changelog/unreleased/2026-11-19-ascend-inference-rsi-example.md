# An Ascend inference RSI example directory

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `examples`
- **Issue:** [#88](https://github.com/Prism-Shadow/penguin-harness-community/issues/88)

[中文版](2026-11-19-ascend-inference-rsi-example.zh.md)

Added `examples/ascend-inference-rsi/` as the fixed home for the Qwen3.8-27B vLLM-Ascend optimization run on 2 × Ascend 950PR. The patch bundle, the per-round RSI records and the throughput and latency report are added to it as the run produces them.

## What the directory holds

- `patches/` — the retained adapter and operator patches, a pinned base commit, `apply.sh` and `restore.sh`.
- `rounds/` and `experience.jsonl` — one record per round, rejected rounds included.
- `report.md` — the throughput and latency report with the correctness and noise results.
- `assets/` — the fixed prompt set, the benchmark invocation and the evaluator entry point.
