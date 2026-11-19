# Ascend inference RSI report

## Environment

- Hardware: 2 × Ascend 950PR, 128 GB HBM per device, one node.
- Driver: 25.7.rc1.10.
- CANN: 9.2.1; `acl.get_soc_name()` returns `Ascend950PR_9579`.
- Python: 3.11.18 in `/opt/miniconda3/envs/ascend`.
- torch: 2.10.0+cpu; torch_npu: 2.10.0.post7.
- vLLM: 0.30.0+empty; vLLM-Ascend: 0.30.0 at `0c002b4b44cd2e7e12a094e6f778b62ed793afba`.
- Model: Qwen3.8-27B-w8a8, read from `/workspace/shared_assets/OssSGLangMeetup/model/`.
- Serving: TP=1 on NPU 0, `FULL_DECODE_ONLY`, MTP speculative decoding, `max-num-seqs` 32, 32768 context.

## Baseline

Five runs of the reference configuration, 32 random prompts of 128 input and 128 output tokens, seed 0:

| Metric | Median | Range | CV |
| --- | --- | --- | --- |
| Mean TPOT | 26.16 ms | 24.59–26.44 ms | 2.68% |
| Median TPOT | 26.61 ms | 24.77–27.15 ms | 3.55% |
| Output throughput | 814.2 tok/s | 803.7–854.1 tok/s | 2.22% |
| Total token throughput | 1962.5 tok/s | 1937.0–2058.6 tok/s | 2.22% |
| Mean TTFT | 718.4 ms | 715.4–722.3 ms | 0.31% |

The noise floor for later rounds is 8.04% for mean TPOT and 6.66% for output throughput.

## Method

The run profiled the decode step, swept the MTP speculative-token count, tried the runtime dynamic scheduler, and retained an operator-level serving-mode switch.

1. Baseline: 5 runs of the reference configuration.
2. MTP sweep: 1, 2, 4 and 5 speculative tokens at 32 concurrency, three runs each.
3. Dynamic scheduler: `num_speculative_tokens_per_batch_size` with ranges 1–16 and 17–32.
4. Serving mode: `VLLM_ASCEND_SERVING_MODE` selects 3 tokens (`latency`) or 1 token (`throughput`) in `vllm_ascend/platform.py`.

The retained patch is `patches/0001-ascend-serving-mode.patch`, applied to vLLM-Ascend at `0c002b4b44cd2e7e12a094e6f778b62ed793afba`.

## Results

| Metric | Baseline (3 tokens) | Throughput mode (1 token) | Delta |
| --- | --- | --- | --- |
| Output throughput at concurrency 32 | 814.2 tok/s | 904.7 tok/s | +11.1% |
| Mean TPOT at concurrency 32 | 26.16 ms | 26.09 ms | -0.3% |
| Mean TTFT at concurrency 32 | 718.4 ms | 698.0 ms | -2.8% |

Latency mode keeps the baseline single-stream result: 11.10 ms mean TPOT and 85.8 tok/s at concurrency 1, against 10.82 ms and 88.6 tok/s for the raw three-token configuration.

The MTP sweep at concurrency 32:

| Speculative tokens | Output throughput (tok/s) | Acceptance (%) |
| --- | --- | --- |
| 3 | 814.2 | 50.2 |
| 1 | 910.4 | 76.6 |
| 2 | 865.9 | 62.1 |
| 4 | 769.8 | 43.2 |
| 5 | 717.7 | 35.9 |

The runtime dynamic scheduler was rejected: vLLM forces `PIECEWISE` graphs when the speculative-token count can change at runtime, which costs 5–8% at concurrency 32, and `VLLM_USE_V2_MODEL_RUNNER=1` fails to initialize the engine core on this stack.

## Correctness

The exact output hash is not a usable gate on this stack. Two of eight fixed prompts changed between two identical MTP-3 runs, which is the known MTP nondeterminism rather than a candidate regression. The hash attempt is kept in `assets/correctness.py` and `assets/prompts.jsonl` for the record.

The retained gate is a 20-question accuracy set (`assets/qa.jsonl`, `assets/accuracy.py`), temperature 0, seed 0:

- Baseline, latency mode: 20/20.
- Throughput mode: 20/20.
- Allowed difference: one question (5%).

A candidate that changes an answer by more than one question is rejected.

## Noise

The baseline was measured five times; the coefficient of variation is 2.68% for mean TPOT and 2.22% for output throughput. The acceptance floor is `max(3%, 3 × CV)`: 8.04% for TPOT and 6.66% for throughput.

Each candidate was measured three times at the same concurrency, with the same container, prompt file and seed, one server instance at a time. The medians are reported above. The throughput-mode gain of 11.1% clears the 6.66% floor.

## Stress

120 consecutive benchmark runs at concurrency 32 in throughput mode, about ten minutes of continuous load. No request failed. Median mean TPOT was 26.10 ms in the first 20 runs and 26.17 ms in the last 20; output throughput was 926.9 and 920.5 tok/s. Power and HBM stayed flat and the server was not restarted.

## Reproduction

```bash
# Environment
bash assets/install-env.sh

# Apply the retained patch to vLLM-Ascend
bash patches/apply.sh /opt/vllm-ascend

# Throughput mode
VLLM_ASCEND_SERVING_MODE=throughput SPEC_TOKENS=3 bash assets/serve.sh
NUM_PROMPTS=32 MAX_CONCURRENCY=32 bash assets/bench.sh throughput.json

# Latency mode
VLLM_ASCEND_SERVING_MODE=latency SPEC_TOKENS=3 bash assets/serve.sh
NUM_PROMPTS=8 MAX_CONCURRENCY=1 bash assets/bench.sh latency.json

# Correctness
python3 assets/accuracy.py --save baseline_accuracy.json
python3 assets/accuracy.py --check baseline_accuracy.json
```

The base commit and component versions are in `patches/base.txt`.

## Threats to validity

- One node with two devices; only one device is used for serving, and there is no multi-node result.
- One model, one quantization and one prompt distribution; the MTP optimum can move with output length and acceptance.
- The serving mode is operator-selected, not runtime-adaptive. Misclassifying the workload costs up to 11% throughput in latency mode or 21% single-stream throughput in throughput mode.
- The dynamic scheduler was rejected on this vLLM-Ascend build; a later build that keeps full graphs under a dynamic speculative schedule could supersede this patch.
- The exact output hash is unavailable because of MTP nondeterminism; correctness rests on the accuracy gate.
