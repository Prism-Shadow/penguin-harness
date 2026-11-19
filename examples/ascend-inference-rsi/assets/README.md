# Assets

The scripts and fixed inputs used by the run.

| File | Purpose |
| --- | --- |
| `install-env.sh` | Rebuilds the Python 3.11, CANN-facing torch/torch_npu and vLLM/vLLM-Ascend stack |
| `serve.sh` | Starts the server; `VLLM_ASCEND_SERVING_MODE` selects the MTP budget, `SPEC_SCHEDULE` is for experiments |
| `bench.sh` | Fixed benchmark: 32 random prompts of 128/128, seed 0, configurable concurrency |
| `correctness.py` | The exact-hash attempt; kept to record why the hash is not a usable gate |
| `prompts.jsonl` | The prompts used by `correctness.py` |
| `accuracy.py` | The retained correctness gate: 20 fixed questions, temperature 0 |
| `qa.jsonl` | The questions and reference answers for `accuracy.py` |
| `prompts.example.jsonl`, `experience.example.jsonl` | Format examples for the prompt set and the round record |

The prompt file is identical for the baseline and every candidate; changing it invalidates the comparison.
