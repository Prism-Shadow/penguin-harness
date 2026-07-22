---
name: llamafactory
description: Fine-tune LLMs with LLaMA-Factory — register datasets, train via YAML configs, merge LoRA adapters and serve the result.
short_description: Fine-tune models with LLaMA-Factory.
short_description_zh: 用 LLaMA-Factory 微调模型。
version: 1
updated: 2026-07-22T00:00:00Z
---

# LLaMA-Factory Fine-Tuning

LLaMA-Factory fine-tunes open-weight LLMs (LoRA/QLoRA and full-parameter; SFT, DPO and more) through the `llamafactory-cli` command driven by YAML configs.

## Before you start

If the user's message only invokes this skill (e.g. "use llamafactory skill") without a concrete request, ask the user what they want to fine-tune. Do not run any command until the goal is clear.

Confirm before training:

- GPU memory (`nvidia-smi`) — it bounds the model size and method; LoRA needs far less than full fine-tuning.
- The base model: a Hugging Face id or a local path.
- The dataset: where it lives and which format it is in.
- The goal: SFT with LoRA is the usual starting point.

## Install

```bash
git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git
cd LLaMA-Factory
pip install -e ".[torch,metrics]"
```

## Data

Register every dataset in `data/dataset_info.json`; the alpaca and sharegpt formats are supported. A minimal local entry:

```json
"my_dataset": { "file_name": "my_dataset.json" }
```

alpaca rows carry `instruction` / `input` / `output`; sharegpt rows carry a `conversations` list. Put the data file under `data/` next to the registry.

## Train

Copy an example config such as `examples/train_lora/llama3_lora_sft.yaml` and adjust it:

```yaml
model_name_or_path: meta-llama/Meta-Llama-3-8B-Instruct
stage: sft
do_train: true
finetuning_type: lora
lora_target: all
dataset: my_dataset
template: llama3
output_dir: saves/llama3-8b/lora/sft
learning_rate: 1.0e-4
num_train_epochs: 3.0
```

```bash
llamafactory-cli train my_sft.yaml
```

`llamafactory-cli webui` launches the no-code web UI for the same workflow.

## Merge and export

Merge the LoRA adapter into the base weights for standalone serving (start from `examples/merge_lora/llama3_lora_sft.yaml`; keys `model_name_or_path`, `adapter_name_or_path`, `template`, `export_dir`):

```bash
llamafactory-cli export merge_config.yaml
```

## Try the result

```bash
llamafactory-cli chat inference_config.yaml   # interactive chat with the tuned model
llamafactory-cli api inference_config.yaml    # OpenAI-compatible API server
```

## Close the loop

Serve the exported model — vLLM on NVIDIA/AMD GPUs, Ollama on macOS or CPU-only machines (see the `vllm` and `ollama` skills) — and register the endpoint:

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:8000/v1 --model-id <served-model-name> --api-key <key>
```

When registering for an AI app under development, `--root` must point at the app's own data root (e.g. `--root ./penguin_data`), never the global `~/.penguin/data`; confirm with `penguin config model list`. PenguinHarness agents then run on the fine-tuned model — building, evaluating and tuning AI apps on it end to end.
