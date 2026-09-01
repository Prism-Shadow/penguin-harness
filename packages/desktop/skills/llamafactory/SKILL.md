---
name: llamafactory
description: Fine-tune LLMs with LlamaFactory — register datasets, train via YAML configs, merge LoRA adapters and serve the result.
short_description: Fine-tune models with LlamaFactory.
short_description_zh: 用 LlamaFactory 微调模型。
version: 1
updated: 2026-07-22T00:00:00Z
---

# LlamaFactory Fine-Tuning

LlamaFactory fine-tunes open-weight LLMs (LoRA/QLoRA and full-parameter; SFT, DPO and more) through the `llamafactory-cli` command driven by YAML configs.

## Before you start

If the user's message only invokes this skill (e.g. "use llamafactory skill") without a concrete request, ask the user what they want to fine-tune. Do not run any command until the goal is clear.

Confirm before training:

- GPU memory (`nvidia-smi`) — it bounds the model size and method; LoRA needs far less than full fine-tuning.
- The base model: a Hugging Face id or a local path.
- The dataset: where it lives and which format it is in.
- The goal: SFT with LoRA is the usual starting point.

## Install

```bash
git clone --depth 1 https://github.com/hiyouga/LlamaFactory.git
cd LlamaFactory
pip install -e .
pip install -r requirements/metrics.txt   # optional: evaluation metrics
```

## Data

Register every dataset in `data/dataset_info.json`; the alpaca and sharegpt formats are supported. A minimal local entry:

```json
"my_dataset": { "file_name": "my_dataset.json" }
```

alpaca rows carry `instruction` / `input` / `output`; sharegpt rows carry a `conversations` list. Put the data file under `data/` next to the registry.

## Train

Training is driven by a YAML config. Start from the shipped example `examples/train_lora/qwen3_lora_sft.yaml`, or save a minimal config as `my_sft.yaml`, e.g. for [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B):

```yaml
model_name_or_path: Qwen/Qwen3-1.7B
trust_remote_code: true
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 8
lora_target: all
dataset: my_dataset
template: qwen3
output_dir: saves/qwen3-1.7b/lora/sft
learning_rate: 1.0e-4
num_train_epochs: 3.0
bf16: true
```

```bash
llamafactory-cli train my_sft.yaml
```

`llamafactory-cli webui` launches the no-code web UI for the same workflow.

## Merge and export

Merge the LoRA adapter into the base weights for standalone serving. Start from `examples/merge_lora/qwen3_lora_sft.yaml`, pointing `model_name_or_path`, `adapter_name_or_path` and `template` at your run (never merge into a quantized base):

```yaml
model_name_or_path: Qwen/Qwen3-1.7B
adapter_name_or_path: saves/qwen3-1.7b/lora/sft
template: qwen3
trust_remote_code: true
export_dir: saves/qwen3-1.7b-sft-merged
```

```bash
llamafactory-cli export my_merge.yaml
```

## Try the result

Both commands take an inference config — derive it from `examples/inference/qwen3_lora_sft.yaml`, again pointing the model, adapter and template at your run:

```yaml
model_name_or_path: Qwen/Qwen3-1.7B
adapter_name_or_path: saves/qwen3-1.7b/lora/sft
template: qwen3
infer_backend: huggingface
trust_remote_code: true
```

```bash
llamafactory-cli chat my_infer.yaml   # interactive chat with the tuned model
llamafactory-cli api my_infer.yaml    # OpenAI-compatible API server
```

## Close the loop

Serve the merged export as a standalone endpoint — vLLM serves the export directory directly, while Ollama needs an import first (a `Modelfile` with `FROM /path/to/export`, then `ollama create`; supported model architectures only) — then register the endpoint with PenguinHarness so agents can build, evaluate and tune AI apps on the fine-tuned model end to end.
