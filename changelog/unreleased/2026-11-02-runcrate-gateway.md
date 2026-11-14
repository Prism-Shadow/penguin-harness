# Runcrate gateway group

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `model-catalog`, `ui`, `web`, `cli`, `docs`, `plugins`

[中文版](2026-11-02-runcrate-gateway.zh.md)

[Runcrate](https://runcrate.ai) joined the built-in groups as an OpenAI-compatible gateway for open-weight models, between Atlas Cloud and Z.AI in the default order. Its rows go to MMSP's generic Chat Completions client at the preset base URL `https://api.runcrate.ai/v1`, the same path the Atlas Cloud, SiliconFlow, Fireworks AI, TokenDance and Qwen gateway groups take, so the group needed no new client. As on Atlas Cloud, the group pins `openai-chat` and takes models added by hand (**Add model** on its header, `penguin config model add --provider runcrate`), which follow the group's endpoint and protocol: the gateway serves more open-weight models than the catalog presets. The `penguin-config` skill (`2026.11.02.1`) names `runcrate` among the groups that take models added by hand. Like every gateway group, it records the `OPENAI_*` pair and never falls back to it, so a Runcrate row needs a key of its own or the group's. Wherever provider logos appear, the group shows Runcrate's `>_` prompt mark, traced from its app icon.

## Rows

Ids, context windows, input modalities and prices were read from the gateway's catalog API (`GET https://api.runcrate.ai/v1/models`) on 2026-11-02. Its prices are USD per token and the rows store them per million tokens. The API lists a cache-write price equal to the input price, so `cache_write` carries the input price. The rows are DeepSeek, Qwen and GLM models the other gateway groups preset:

- `deepseek-ai/DeepSeek-V4.1-Flash` (**DeepSeek V4.1 Flash**), 1,048,576-token context window, image input.
- `Qwen/Qwen3.6-35B-A3B` (**Qwen 3.6 35B A3B**), 262,144-token context window, image input.
- `zai-org/GLM-5.3` (**GLM-5.3**), 1,048,576-token context window, text only.

## Existing Projects

Presets are copied into a Project when it is created, so a new Project carries the group right away. An existing Project picks the rows up through **Add new models** on the models page, which also writes the group's endpoint and protocol.
