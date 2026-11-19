# Ascend Inference RSI

A reproducible optimization run for Qwen3.8-27B with vLLM-Ascend on 2 × Ascend 950PR: profile the decode step, sweep the speculative-token budget, and keep only the changes that clear a measured noise floor and a correctness gate.

## Result

- Baseline: 814.2 tok/s at concurrency 32, mean TPOT 26.16 ms over five runs.
- Throughput mode: 904.7 tok/s (+11.1%) with one MTP speculative token.
- Latency mode keeps 11.10 ms mean TPOT at concurrency 1 with three speculative tokens.
- Retained patch: `patches/0001-ascend-serving-mode.patch`, an opt-in `VLLM_ASCEND_SERVING_MODE` switch in `vllm_ascend/platform.py`.
- Correctness: 20/20 on the fixed accuracy set in both modes. The exact output hash is unusable on this stack because the MTP path is not bit-stable across repeated runs.
- Stress: 120 consecutive runs at concurrency 32, no failures, TPOT drift 0.2%.

The full numbers, the rejected alternatives and the reproduction commands are in [report.md](report.md).

## Layout

| Path | Content |
| --- | --- |
| `patches/` | The retained patch, the pinned base commit, `apply.sh` and `restore.sh` |
| `rounds/` | Baseline, MTP sweep and serving-mode rounds with plans, metrics and verdicts |
| `experience.jsonl` | One JSON line per round, rejected rounds included |
| `report.md` | Environment, baseline, method, results, correctness, noise and threats |
| `assets/` | Install, serve, benchmark, correctness and accuracy scripts |

## Method

1. Baseline: five runs of the reference configuration.
2. MTP sweep: 1, 2, 4 and 5 speculative tokens against the three-token baseline.
3. Runtime dynamic scheduler: tried and rejected — it forces `PIECEWISE` graphs on this stack, and the V2 model runner fails to initialize.
4. Serving mode: 3 tokens for latency-sensitive serving, 1 token for throughput serving, selected at startup by `VLLM_ASCEND_SERVING_MODE`.

## Reproduction

```bash
bash assets/install-env.sh
bash patches/apply.sh /opt/vllm-ascend
VLLM_ASCEND_SERVING_MODE=throughput MODEL=/opt/models/Qwen3.8-27B-w8a8 bash assets/serve.sh
NUM_PROMPTS=32 MAX_CONCURRENCY=32 bash assets/bench.sh throughput.json
```

Copy the W8A8 checkpoint from the read-only shared mount to local disk once (`cp -a` to `/opt/models/`) so each server restart does not reload 28 GB over GlusterFS.

## What is not claimed

- No multi-node result: the run uses one node and one device for serving.
- No model or quantization change.
- No runtime adaptation: the mode is selected by the operator, not by the live batch size.
- No bit-exact output claim: the MTP path is not bit-stable on this stack.
