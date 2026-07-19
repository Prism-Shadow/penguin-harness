---
name: penguin-cli
description: Manage model API keys, default models and per-agent vault secrets with the penguin CLI.
short_description: Manage models and secrets with the penguin CLI.
short_description_zh: 用 penguin CLI 管理模型与密钥。
version: 1
updated: 2026-07-17T00:00:00Z
---

# Penguin CLI

The `penguin` CLI manages model credentials, default models and per-agent vault secrets. Configuration goes through the CLI only — never read or hand-edit the underlying hidden files.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-cli skill") without a concrete request, ask the user what they want to configure. Do not run any command until the goal is clear.

## Models

Add or update a model (upsert by the stored model id; re-run with more options to amend an entry):

```bash
penguin config model add --model-id <upstream_id> [--provider <group>] [--api-key <key>] [--base-url <url>] \
  [--client-type <type>] [--context-window <n>] [--vision | --no-vision] \
  [--price-cache-read <n>] [--price-cache-write <n>] [--price-output <n>] \
  [--project-id <id>] [--root <dir>] [--set-default]
```

- `--model-id` takes the provider's upstream model id (what the API expects). The stored id is always `<provider>/<upstream_id>`: `--provider` picks the provider group, and when omitted it is inferred from the built-in catalog (unrecognized ids fall back to `custom`). The upstream id is persisted automatically as the entry's request id, so nothing extra is needed for it to reach the API unchanged.
- For any OpenAI chat-completion compatible endpoint use `--client-type openai --base-url <endpoint>`; omit `--client-type` to auto-route by model id.
- Prices are USD per million tokens (cache read / cache write / output).
- `--vision` / `--no-vision` mark whether the model accepts images; omitting both keeps the current value (default is vision-capable).
- All `penguin config model ...` and `penguin config vault ...` commands accept `--root <dir>` to target another data root (default `PENGUIN_HOME`, then `~/.penguin`).

Other model commands:

```bash
penguin config model default --model-id <upstream_id> --provider <group> [--root <dir>]   # set the project default model
penguin config model vision --model-id <upstream_id> --provider <group> [--root <dir>]    # set the project vision model (reads images for text-only sessions)
penguin config model list [--root <dir>]                      # list models; api_key is shown masked
```

## Vault (per-agent secrets)

The vault holds an agent's environment-variable secrets (third-party API keys etc.); values are injected into that agent's shell subprocesses:

```bash
penguin config vault set --key <NAME> --value <value> [--project-id <id>] [--agent-id <id>] [--root <dir>]
penguin config vault list [--project-id <id>] [--agent-id <id>] [--root <dir>]      # values are shown masked
penguin config vault remove --key <NAME> [--project-id <id>] [--agent-id <id>] [--root <dir>]
```

- `--project-id` defaults to `default_project`, `--agent-id` to `default_agent`.
- Key names follow shell variable rules (letter or underscore first, then letters, digits and underscores); values are limited to 8192 characters.

## Language

```bash
penguin config lang <en|zh>   # persist the CLI language via PENGUIN_LANG in your shell rc
```

## Running agents

`penguin run -m "<task>" [--model-id <id>] [--agent-id <id>] [--workspace <path>] [--approve <mode>]` runs one task; `penguin chat [--resume [session_id]]` starts or resumes an interactive chat with the same options.

## Storage

- `<project_dir>/.project_config.toml` — the project's single hidden config file: model list, settings and per-model credentials (`api_key` etc. inlined in each model entry). Configuration is CLI-only — never read, print or hand-edit this file.
- `<project_dir>/agents/<agent_id>/agent_state/.vault.toml` — that agent's vault entries, hidden file; same rule, manage it with `penguin config vault`.
