---
name: penguin-config
description: Manage model API keys, default models and per-agent vault secrets with the penguin CLI.
---

# Penguin Config (CLI)

The `penguin` CLI manages model credentials, default models and per-agent vault secrets. Its primary job is model configuration: `penguin config model add` registers a model, or — without `--model-id` — gives a whole group its key, base URL or protocol, and `penguin config model list` shows the groups' connections and the models currently available. Configuration goes through the CLI only — never read or hand-edit the underlying hidden files.

## Before you start

If the user's message only invokes this skill (e.g. "use penguin-cli skill") without a concrete request, ask the user what they want to configure. Do not run any command until the goal is clear.

## Models

Add or update a model (upsert by the `(provider, model_id)` pair; re-run with more options to amend an entry):

```bash
penguin config model add --provider <group> --model-id <upstream_id> [--api-key <key> | --clear-api-key] \
  [--base-url <url> | --clear-base-url] [--client-type <type> | --clear-client-type] \
  [--context-window <n>] [--max-tokens <n>] [--vision | --no-vision] [--fast-mode | --no-fast-mode] \
  [--price-cache-read <n>] [--price-cache-write <n>] [--price-output <n>] \
  [--project-id <id>] [--root <dir>] [--set-default]
```

- A model is identified by the `(provider, model_id)` pair, so `--provider` and `--model-id` are **both required** to name one — the group is never inferred from the model id, because gateways resell vendor models under their upstream ids and a wrong guess would send the key to another vendor's endpoint. `--model-id` takes the provider's upstream model id (what the API expects) and is persisted as the entry's request id, so it reaches the API unchanged; `--provider` names the group (`deepseek`, `openai`, `anthropic`, `google`, `openrouter`, `siliconflow`, … — `custom` for any other endpoint).
- Only `custom`, `vllm`, `openrouter`, `tokendance`, `siliconflow` and groups of your own take models added by hand. Every other built-in group carries its catalog models only: `model add` there accepts one of that group's catalog model ids (to set its key, limits or prices, or to bring it back) and refuses any other id with "cannot be added". Add such a model under `custom` with `--base-url`, or under a group of your own.
- `--api-key`, `--base-url` and `--client-type` set the model's **own** values, and `--clear-api-key`, `--clear-base-url` and `--clear-client-type` remove them. Omitted, the model follows its group (see [Group connection](#group-connection)), and with no group value it gets the client's default; the built-in catalog is never consulted. A model added to `openrouter`, `tokendance` or `siliconflow` needs only `--provider` and `--model-id` once the group has a key: a new Project already stores those gateways' endpoint and protocol on the group. For an OpenAI chat-completion compatible endpoint under `custom` or a group of your own, use `--client-type openai --base-url <endpoint>`, or set both once on the group; in a vendor group, omit `--client-type` to auto-route by model id.
- Prices are USD per million tokens (cache read / cache write / output).
- `--vision` / `--no-vision` mark whether the model accepts images; omitting both keeps the current value (default is vision-capable).
- `--max-tokens <n>` pins a per-model output cap (positive integer), overriding the Agent's `model.max_tokens`; omit to inherit. Lower it for small-context models — the per-Agent default (32000) cannot fit into e.g. a 32k context window together with any prompt.
- All `penguin config model ...` and `penguin config vault ...` commands accept `--root <dir>` to target another data root (default `PENGUIN_HOME`, then `~/.penguin/data`). Two configuration targets — treat the difference as a hard rule:
  - **Penguin's own model** (self-configuration: the model Penguin itself runs on): pass `--root <data root>` as well — the parent directory of the App Data Dir named in your Environment section. An agent running inside PenguinHarness never sees `PENGUIN_HOME`: the harness strips every `PENGUIN_*` variable from a command's environment, so a command without `--root` falls back to `~/.penguin/data` and configures a root the running server does not read.
  - **An AI app you are building**: `--root` **must** point at the app's own data directory inside the project (e.g. `--root ./penguin_data`, the same path the app gives `createAgent({ root })`) unless the user explicitly chose another location — never write an app's models or keys into the global `~/.penguin/data`, which belongs to the person running Penguin, not to the app.
  - While developing an app, review regularly: `penguin config model list --root <app root>` should show the app's entries, and the global list (no `--root`) should stay clean.

Other model commands:

```bash
penguin config model default --model-id <upstream_id> --provider <group> [--root <dir>]   # set the project default model
penguin config model vision --model-id <upstream_id> --provider <group> [--root <dir>]    # set the project vision model (reads images for text-only sessions)
penguin config model list [--root <dir>]                      # the groups' connections, then the models with the connection each uses; api_key masked, (provider) = from the group, (env) = from an environment variable
penguin config model remove --model-id <upstream_id> --provider <group> [--root <dir>]   # remove one model
```

## Group connection

A group holds one connection — API key, base URL, protocol — in its `[providers.<group>]` table, and every model in it without a value of its own follows it. Each field resolves on its own from the config file alone: the model's value, else the group's, else nothing (the client's default endpoint, MMSP routing by model id, the environment key where allowed). The built-in catalog is only a reference: a new Project's file already stores each gateway's endpoint and protocol on its group. Set a key once on the group rather than on every model. `model add` and `model remove` without `--model-id` act on the group:

```bash
penguin config model add --provider <group> [--api-key <key> | --clear-api-key] [--base-url <url> | --clear-base-url] \
  [--client-type <type> | --clear-client-type] [--project-id <id>] [--root <dir>]
penguin config model remove --provider <group> [--project-id <id>] [--root <dir>]   # removes the group's connection only; its models stay
```

- A field you do not name is left as it is. An empty value is refused: remove a field with its `--clear-*` flag.
- The flags that describe one model (`--context-window`, `--max-tokens`, `--vision`, `--fast-mode`, `--price-*`, `--set-default`) are refused without `--model-id`; nothing is written.
- Any group takes a protocol, `penguin-go` and `opencode-go` included: a model's own protocol always wins over its group's.
- The group key never replaces a key set on one model with `model add --api-key`; the command says how many models keep their own. It reaches only the models that go to the group's endpoint: a model whose own `--base-url` is on another host (scheme, host and port) needs its own `--api-key`.
- For a group of your own on one endpoint, set its connection first, then add each model with only `--provider` and `--model-id`: the models store nothing and follow the group. Removing the group's last model removes its connection too.

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

`penguin run -m "<task>" [--provider <group> --model-id <id>] [--agent-id <id>] [--workspace <path>] [--approve <mode>]` runs one task; `penguin chat [--resume [session_id]]` starts or resumes an interactive chat with the same options. The model reference stays a pair here too: pass `--provider` and `--model-id` together, or neither to run on the project's default model — one without the other is rejected.

## Storage

Paths use `<app_data_dir>`, the App Data Dir value from your Environment section.

- `<app_data_dir>/.project_config.toml` — the project's single hidden config file: model list, settings, each group's connection (`[providers.<group>]`) and the values a model overrides (`api_key` etc. on its entry). Configuration is CLI-only — never read, print or hand-edit this file.
- `<app_data_dir>/agents/<agent_id>/agent_state/.vault.toml` — that agent's vault entries, hidden file; same rule, manage it with `penguin config vault`.
