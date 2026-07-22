---
name: vllm
description: Deploy and serve LLMs with vLLM behind an OpenAI-compatible endpoint, with tool calling enabled for agent workloads.
short_description: Serve models locally with vLLM.
short_description_zh: 用 vLLM 部署本地模型服务。
version: 1
updated: 2026-07-22T00:00:00Z
---

# vLLM Serving

vLLM serves open-weight LLMs on local GPUs with high-throughput inference behind an OpenAI-compatible API, ready for chat and agent workloads.

## Before you start

If the user's message only invokes this skill (e.g. "use vllm skill") without a concrete request, ask the user which model they want to serve and for what. Do not run any command until the goal is clear.

Confirm the environment first:

```bash
nvidia-smi          # NVIDIA: GPU model and free VRAM (AMD ROCm: rocm-smi)
python3 --version   # a recent Python is required
```

Pick a model that fits the available VRAM, and ask what context length the workload needs — both drive the serve flags below.

## Install

Use a fresh virtual environment (or `uv`):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install vllm
```

## Serve

```bash
vllm serve Qwen/Qwen3-8B --port 8000
```

This exposes an OpenAI-compatible API at `http://localhost:8000/v1`. Key flags:

- `--served-model-name <name>` — the model id clients request (defaults to the model path).
- `--api-key <key>` — require this bearer token on every request.
- `--max-model-len <n>` — context window; agent sessions need a large one.
- `--gpu-memory-utilization <0..1>` — fraction of VRAM to claim (default 0.9).
- `--tensor-parallel-size <n>` — shard across `n` GPUs.
- `--dtype <auto|bfloat16|float16>` and `--quantization <awq|gptq|fp8>` — precision and quantized weights.

If the port is taken, pick a free one — never kill a process already listening on it.

## Tool calling — required for agents

Agent harnesses (PenguinHarness included) send `tools` with their requests. vLLM must opt in at startup:

```bash
vllm serve Qwen/Qwen3-8B --enable-auto-tool-choice --tool-call-parser hermes
```

Choose the parser for the model family — e.g. `hermes` for Qwen models, `llama3_json` for Llama models. Without these flags, requests that set tool_choice fail with `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`.

## Verify

```bash
curl http://localhost:8000/v1/models
```

## Register with PenguinHarness

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:8000/v1 --model-id <served-model-name> --api-key <key>
```

When configuring models for an AI app you are building, add `--root ./penguin_data` so the entry lands in the app's own data root — see the `penguin-cli` skill.

## Troubleshooting

- Out of memory at startup: lower `--gpu-memory-utilization` or `--max-model-len`, or serve a quantized model.
- Long prompts truncated or context-length errors: raise `--max-model-len` (bounded by VRAM).
- `400` on tool calls: restart the server with the tool-calling flags above.
