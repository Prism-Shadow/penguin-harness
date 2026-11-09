# Standard Compute gateway group

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `model-catalog`, `web`, `cli`, `docs`, `plugins`

[中文版](2026-11-09-standardcompute-gateway.zh.md)

[Standard Compute](https://standardcompute.com) joined the built-in groups as an OpenAI-compatible gateway, between Runcrate and Z.AI in the default order. Its rows go to MMSP's generic Chat Completions client at the preset base URL `https://api.stdcmpt.com/v1`, the same path the Atlas Cloud and Runcrate groups take, so the group needed no new client. As on Runcrate, the group pins `openai-chat` and takes models added by hand (**Add model** on its header, `penguin config model add --provider standardcompute`), which follow the group's endpoint and protocol: the gateway lists more models than the catalog presets. The `penguin-config` skill (`2026.11.09.1`) names `standardcompute` among the groups that take models added by hand. Like every gateway group, it records the `OPENAI_*` pair and never falls back to it, so a Standard Compute row needs a key of its own or the group's. Keys are issued at [standardcompute.com/dashboard](https://standardcompute.com/dashboard).

## Rows

Ids, context windows and input modalities were read from the gateway's public catalog API (`GET https://api.stdcmpt.com/v1/models`, no credential) on 2026-11-09. The gateway bills by plan and the API lists no per-token prices, so the rows carry no `pricing`: the cost center treats them as uncosted rather than free.

- `StandardCompute` (**Standard Compute (routed)**), the gateway's routed id: each request goes to the cheapest enabled model that can handle it, with automatic fallback. 1,000,000-token context window, text only (the listing gives the routed id no input modalities).
- `deepseek/deepseek-v4-pro` (**DeepSeek V4 Pro**), a pinned id from the same listing, 1,048,576-token context window, text only.

## Existing Projects

Presets are copied into a Project when it is created, so a new Project carries the group right away. An existing Project picks the rows up through **Add new models** on the models page, which also writes the group's endpoint and protocol.
