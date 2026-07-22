---
title: "Serve, measure, fine-tune, repeat: the new Ollama, vLLM and LlamaFactory skills in practice"
date: 2026-07-22
category: practice
excerpt: PenguinHarness 0.1.1 ships three new skills that let an agent stand up and tune the models it runs on. Here is how to use them — a fully private local model with Ollama, and a closed tuning loop where vLLM serves, the agent gets measured, LlamaFactory fixes what it got wrong, and you measure again.
---

Until this release, PenguinHarness could talk to any OpenAI-compatible endpoint but had nothing to say about where that endpoint came from. **0.1.1 adds three skills that close the gap**: `ollama` and `vllm` stand a model up, and `llamafactory` tunes it. Together with the `penguin-cli` skill that registers the result, an agent can now own the whole chain from raw weights to a measured score.

This post is a walkthrough of the two things people actually want from that chain:

1. **A local model nothing leaves.** Ollama on your own machine, wired into PenguinHarness in one command.
2. **A tuning loop.** vLLM serves → the agent runs and gets scored → LlamaFactory fine-tunes on what it got wrong → serve the tuned weights → measure again.

Every command below is what the shipped skills prescribe — you can read them yourself in `packages/skills/skills/{ollama,vllm,llamafactory,penguin-cli}/SKILL.md`, or just ask your agent to use the skill by name.

## Part 1 — a private local model with Ollama

The pitch is simple: Ollama runs open-weight models locally with automatic GPU detection and exposes an OpenAI-compatible API on `http://localhost:11434`. PenguinHarness talks to OpenAI-compatible endpoints. So the entire loop — prompt, reasoning, tool calls, results — stays on the machine. No token crosses a network boundary you do not own.

### Check what is already running

The skill's first rule, before anything else: look before you leap.

```bash
ollama --version   # is Ollama installed?
ollama ps          # is the service already serving models?
```

If port 11434 is already serving, reuse that instance — never kill an existing Ollama process. (This is the same instinct 0.1.1 baked into the default system prompt: never kill a process you did not start, and when a port is busy, pick another one.)

### Install and pull

```bash
curl -fsSL https://ollama.com/install.sh | sh   # Linux; macOS/Windows use the desktop app
ollama pull qwen3.5:0.8b
```

`qwen3.5:0.8b` is the skill's recommendation when you have no preference — small enough to fit almost anywhere, which matters because the model has to fit the machine's RAM or VRAM. Swap in whatever your hardware supports.

### Give it a real context window

This is the step people skip and then spend an afternoon debugging. Ollama's default context window is small; agent sessions are not. Raise it in the server's environment:

```bash
OLLAMA_CONTEXT_LENGTH=32768 ollama serve   # systemd service: set it via `systemctl edit ollama`
```

Or bake it into a model variant with a Modelfile:

```
FROM qwen3.5:0.8b
PARAMETER num_ctx 32768
```

```bash
ollama create qwen3.5-32k -f Modelfile
```

### Verify, then register

The endpoint is `http://localhost:11434/v1` and it accepts any non-empty API key — `ollama` by convention:

```bash
curl http://localhost:11434/v1/models
```

A pulled Ollama model is invisible to PenguinHarness until you add it. Model configuration is the CLI's job:

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
penguin config model list   # the new entry should now be listed
```

Three details in that command are worth understanding rather than copying:

- `--provider custom` is **required**. A model in PenguinHarness is the `(provider, model_id)` pair, and the group is never inferred from the id — gateways resell vendor models under their upstream ids, and a wrong guess would send your key to somebody else's endpoint. `custom` is the group for any endpoint outside the built-in ones.
- `--client-type openai --base-url <endpoint>` is the shape for any OpenAI chat-completion compatible server. Omit `--client-type` only when you want auto-routing by model id, which local ids do not get.
- `--api-key ollama` is not decoration. Ollama accepts any non-empty key, but the field has to be non-empty.

Then run something:

```bash
penguin run -m "Summarize the README in this directory" \
  --provider custom --model-id qwen3.5:0.8b --approve allow-all
```

Add `--set-default` to the `model add` command if you would rather not pass the pair every time. And if your local model has a small context window, cap its output too — `penguin config model add --max-tokens <n>` sets a per-model output cap that overrides the Agent's default (32000), which on its own cannot fit into a 32k context window alongside any prompt. That per-model cap is new in 0.1.1, and it exists precisely because a local 32k model refusing every request is such an unhelpful failure mode.

### The --root rule

One hard rule, worth stating before you go further, because it is the difference between a tidy project and a polluted home directory:

- **Configuring the model PenguinHarness itself runs on** — use the default data root, no `--root`.
- **Configuring a model for an AI app you are building** — `--root` **must** point at the app's own data directory inside the project (e.g. `--root ./penguin_data`, the same path the app hands `createAgent({ root })`), never the global `~/.penguin/data`, which belongs to the person running Penguin and not to your app.

While developing an app, check both regularly: `penguin config model list --root ./penguin_data` should show the app's entries, and a bare `penguin config model list` should stay clean.

## Part 2 — closing the tuning loop with vLLM and LlamaFactory

Part 1 gets you a local model. Part 2 gets you a *better* one. The loop has four moves, and PenguinHarness is the instrument in the middle:

```text
vLLM serves the base model
      ↓
the agent runs, and gets scored against a rubric
      ↓
LlamaFactory fine-tunes on what it got wrong
      ↓
vLLM serves the tuned weights → score again
```

The example below uses `Qwen/Qwen3-1.7B` throughout, which is the base model in LlamaFactory's shipped example config — keeping one model across both halves means the training `template` is the one the skill actually prescribes, rather than a value I would have to guess for you.

### Step 1 — serve the base model with vLLM

vLLM needs an NVIDIA or AMD GPU (Ollama is the simpler default and the only option on macOS or CPU-only machines; pick vLLM when throughput matters). Confirm the hardware first:

```bash
nvidia-smi          # NVIDIA: GPU model and free VRAM (AMD ROCm: rocm-smi)
python3 --version
```

Install into a fresh virtual environment, then serve:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install vllm
vllm serve Qwen/Qwen3-1.7B --port 8000 --api-key local-dev \
  --enable-auto-tool-choice --tool-call-parser hermes
```

**Do not drop those last two flags.** Agent harnesses — PenguinHarness included — send `tools` with their requests, and vLLM has to opt in at startup. Without them, requests that set a tool choice fail with `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`. Pick the parser for the model family: `hermes` for Qwen models, `llama3_json` for Llama models.

The other flags you will reach for, per the skill: `--served-model-name <name>` (the id clients request, defaulting to the model path), `--api-key <key>` (require a bearer token), `--max-model-len <n>` (context window — agent sessions need a large one), `--gpu-memory-utilization <0..1>` (default 0.9), `--tensor-parallel-size <n>`, and `--dtype` / `--quantization` for precision and quantized weights. If the port is taken, pick a free one — never kill the process listening on it.

Verify and register exactly as before, only the port and the id change:

```bash
curl http://localhost:8000/v1/models

penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:8000/v1 --model-id Qwen/Qwen3-1.7B --api-key local-dev
penguin config model list
```

(`--model-id` takes whatever `--served-model-name` reports — the default is the model path, so `Qwen/Qwen3-1.7B` here — and `--api-key` is the bearer token you gave `vllm serve --api-key`.)

One 0.1.1 fix makes this materially less painful than it used to be: strict OpenAI-compatible servers reject a request carrying `tools: []`, and vLLM says so bluntly — `400 … tools must not be an empty array. Either provide at least one tool or omit the field entirely.` Every tool-less request PenguinHarness makes (the Models-page connectivity probe, session-title generation, the vision describer) used to trip on that. The harness now omits the field entirely when the tool list is empty, so a vLLM endpoint behaves the same as a hosted one.

### Step 2 — run the agent, and score it

Now measure the model you just served. Point a run at it:

```bash
penguin run -m "<your task>" --provider custom --model-id Qwen/Qwen3-1.7B --approve allow-all
```

For anything you intend to *improve*, a single run is not a measurement. The `benchmark-design` skill builds a real one: a Benchmark directory of cases, each with a public `statement/` the agent sees and a private `rubric/` it never does, a `runs` count so a nondeterministic local model gets averaged rather than sampled once, and a `scoreboard.yaml` that accumulates results. The `agent-evaluation` skill runs and scores exactly one case, in an isolated workspace, and returns nothing but protocol metadata — that isolation is what keeps the rubric out of the tested agent's context.

Ask your agent to use `benchmark-design` and it will drive the whole thing. What comes back is the part that matters here: a score, per case, recorded against the `(provider, model_id)` pair that produced it — so a base model and its tuned successor are directly comparable — and every run deep-links to its own Trace. You are not reading a number; you can open the exact session and see which step lost the point.

### Step 3 — fine-tune on what it got wrong

That Trace is your dataset. The cases the model failed, the tool call it got wrong, the format it kept ignoring — turn them into training examples.

Install LlamaFactory:

```bash
git clone --depth 1 https://github.com/hiyouga/LlamaFactory.git
cd LlamaFactory
pip install -e .
pip install -r requirements/metrics.txt   # optional: evaluation metrics
```

Register the dataset. Every dataset has to be declared in `data/dataset_info.json`, with the data file sitting next to it under `data/`:

```json
"my_dataset": { "file_name": "my_dataset.json" }
```

The alpaca and sharegpt formats are supported — alpaca rows carry `instruction` / `input` / `output`, sharegpt rows carry a `conversations` list. Agent transcripts map naturally onto sharegpt; single-turn corrections onto alpaca.

Training is driven by a YAML config. Start from the shipped `examples/train_lora/qwen3_lora_sft.yaml`, or write a minimal one:

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

LoRA SFT is the usual starting point, and it needs far less GPU memory than full fine-tuning — check `nvidia-smi` before choosing. `llamafactory-cli webui` gives you the same workflow with no YAML at all.

Before serving anything, try it:

```bash
llamafactory-cli chat my_infer.yaml   # interactive chat with the tuned model
llamafactory-cli api my_infer.yaml    # or an OpenAI-compatible API server, adapter and all
```

...where `my_infer.yaml` derives from `examples/inference/qwen3_lora_sft.yaml`, pointing `model_name_or_path`, `adapter_name_or_path` and `template` at your run.

### Step 4 — merge, serve, measure again

For standalone serving, merge the LoRA adapter into the base weights. Start from `examples/merge_lora/qwen3_lora_sft.yaml`:

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

Never merge into a quantized base. Then serve the export directory — vLLM takes it directly:

```bash
vllm serve saves/qwen3-1.7b-sft-merged --port 8001 --api-key local-dev \
  --served-model-name qwen3-1.7b-sft \
  --enable-auto-tool-choice --tool-call-parser hermes
```

Ollama can serve it too, but needs an import first — a `Modelfile` with `FROM /path/to/export`, then `ollama create` (supported model architectures only).

Register the tuned endpoint as its own model rather than overwriting the base one, so both stay comparable:

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:8001/v1 --model-id qwen3-1.7b-sft --api-key local-dev
```

Then re-run the same Benchmark against the new pair. Because evaluations record the `(provider, model_id)` pair that produced them, the scoreboard now holds both, and the difference is the only thing you have to look at. If it did not improve, you have the Traces for both runs to tell you why — and the loop starts again.

## What usually goes wrong

- **`400 … tools must not be an empty array`** — that was the harness sending `tools: []`; upgrade to 0.1.1, where the field is omitted when empty.
- **`400 "auto" tool choice requires --enable-auto-tool-choice…`** — the vLLM server was started without the tool-calling flags. Restart it with them; real tool use on vLLM needs them regardless of which client is calling.
- **`400 This model's maximum context length is 32768 tokens…`** — the agent asked for more output tokens than the model's context allows. Set a per-model cap with `penguin config model add --max-tokens <n>`.
- **Out of memory at vLLM startup** — lower `--gpu-memory-utilization` or `--max-model-len`, or serve a quantized model.
- **Prompts truncated, or context-length errors mid-session** — raise `--max-model-len` on vLLM, or `OLLAMA_CONTEXT_LENGTH` / `num_ctx` on Ollama.
- **The model is served but PenguinHarness cannot see it** — a served or pulled model is invisible until `penguin config model add`. Confirm with `penguin config model list` (and pass `--root` if it belongs to an app you are building).

## Why this matters

The interesting property here is not that any single step is hard — it is that all four now sit inside one system. The model you serve, the agent that runs on it, the score that says whether it is good, and the training run that fixes the gap are no longer four disconnected tools with four sets of conventions. An agent holding these skills can walk the loop itself: serve, measure, tune, serve, measure — and every round is written down in a Trace and a scoreboard that you can audit afterwards.

Locally. On your own weights. With nothing leaving the machine.

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```
