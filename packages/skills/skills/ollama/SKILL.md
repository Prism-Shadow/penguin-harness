---
name: ollama
description: Deploy and serve local models with Ollama — pull and run them, then expose the OpenAI-compatible endpoint to apps and agents.
short_description: Run local models with Ollama.
short_description_zh: 用 Ollama 运行本地模型。
version: 1
updated: 2026-07-22T00:00:00Z
---

# Ollama Serving

Ollama runs open-weight models locally with automatic GPU detection and an OpenAI-compatible API on `http://localhost:11434`.

## Before you start

If the user's message only invokes this skill (e.g. "use ollama skill") without a concrete request, ask the user what they want. Do not run any command until the goal is clear.

Ask the user which model to run; if they have no preference, recommend the small default [Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) (`ollama pull qwen3.5:0.8b`). The model must fit the machine's RAM/VRAM.

Ollama runs everywhere — macOS, Linux and Windows, on CPUs as well as NVIDIA/AMD GPUs — so engine choice follows the user's preference: Ollama is the simple default, while vLLM targets high-throughput GPU serving. Check the current state first:

```bash
ollama --version   # is Ollama installed?
ollama ps          # is the service already serving models?
```

If port 11434 is already serving, reuse that instance — never kill an existing Ollama process.

## Suggested workflow

1. Ask the user which model to run; with no preference, recommend [Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) (`qwen3.5:0.8b`).
2. Pick the engine the user prefers: Ollama is the default; vLLM covers high-throughput GPU serving.
3. Install Ollama if missing, then `ollama pull qwen3.5:0.8b`.
4. Verify with `curl http://localhost:11434/v1/models`.
5. Register the endpoint: `penguin config model add ... --client-type openai --base-url http://localhost:11434/v1` — a pulled Ollama model is not visible to Penguin until added.
6. Confirm the new entry with `penguin config model list`.

## Install

```bash
curl -fsSL https://ollama.com/install.sh | sh   # Linux; macOS/Windows use the desktop app
```

The service then listens on `http://localhost:11434`.

## Pull and run

```bash
ollama pull qwen3.5:0.8b   # download a model
ollama run qwen3.5:0.8b    # interactive chat (pulls first if missing)
ollama list                # downloaded models
ollama ps                  # models loaded in memory
ollama stop qwen3.5:0.8b   # unload a model
```

## OpenAI-compatible endpoint

The endpoint is `http://localhost:11434/v1`; any non-empty API key is accepted (conventionally `ollama`):

```bash
curl http://localhost:11434/v1/models
```

## Context length

The default context window is small, and agent sessions need a large one. Raise it in the server's environment:

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

## Register with PenguinHarness

Model configuration is the penguin CLI's job — `penguin config model add` registers an endpoint and `penguin config model list` shows what has been registered. A pulled Ollama model is not visible to Penguin until you add it:

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
penguin config model list   # the new entry should now be listed
```
