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

If the user's message only invokes this skill (e.g. "use ollama skill") without a concrete request, ask the user which model they want to run and for what. Do not run any command until the goal is clear.

Check the current state first:

```bash
ollama --version   # is Ollama installed?
ollama ps          # is the service already serving models?
```

If port 11434 is already serving, reuse that instance — never kill an existing Ollama process. Pick a model size that fits the machine's RAM/VRAM before pulling.

## Install

```bash
curl -fsSL https://ollama.com/install.sh | sh   # Linux; macOS/Windows use the desktop app
```

The service then listens on `http://localhost:11434`.

## Pull and run

```bash
ollama pull qwen3:8b   # download a model
ollama run qwen3:8b    # interactive chat (pulls first if missing)
ollama list            # downloaded models
ollama ps              # models loaded in memory
ollama stop qwen3:8b   # unload a model
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
FROM qwen3:8b
PARAMETER num_ctx 32768
```

```bash
ollama create qwen3-32k -f Modelfile
```

## Register with PenguinHarness

```bash
penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --model-id qwen3:8b --api-key ollama
```

When configuring models for an AI app you are building, add `--root ./penguin_data` so the entry lands in the app's own data root — see the `penguin-cli` skill.
