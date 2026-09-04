# A vLLM group in the model catalog, with its protocol pinned by the group

- **Date:** 2026-09-03
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`

[中文版](2026-09-03-vllm-model-group.zh.md)

The model catalog gains a **vLLM** group, placed immediately before Custom, holding the eight
models AgentHub's `openai-chat-vllm-adapter` client carries a per-model thinking switch for:
`Qwen/Qwen3.8-Flash-Next`, `Qwen/Qwen3.8-27B`, `Qwen/Qwen3.6-35B-A3B`, `Qwen/Qwen3.5-0.8B`,
`Qwen/Qwen3.5-9B`, `deepseek-ai/DeepSeek-V4-Pro`, `deepseek-ai/DeepSeek-V4-Flash` and
`deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`.

These are self-hosted, which is what the group's shape follows from. The rows price at
**zero** — nobody bills per token for a server the user runs, and what it does cost is that
operator's own hardware, which no catalog rate expresses. Zero here is a real rate, not a
missing one: the rows show the free badge and contribute 0 to the cost center, the same
treatment the `:free` gateway rows already get. They carry **no base URL**: every deployment has its own, so the user supplies it as in the Custom
group. Context windows are each model's native length as documented at `recipes.vllm.ai`
(262,144 for the Qwen rows, 1,000,000 for the DeepSeek V4 rows); a deployment started with a
smaller `--max-model-len` serves less, and the entry's context window is editable.

The group's glyph is vLLM's official mark, taken from the project's media kit and flattened
from its two brand colours to `currentColor` the way Qwen's gradient wordmark already is —
the provider glyphs are one monochrome family, so a row of them reads as one.

## The protocol is a property of the group

`ModelProviderInfo` gains a `clientType` field: the protocol every entry in a group speaks,
models the user adds included. vLLM is the only group that declares one, and reading it goes
through `providerClientType` so the places that decide a saved model's protocol answer as one:

- adding a model to the group preselects `openai-chat-vllm-adapter` rather than the generic
  `openai-chat`, and the dialog names the protocol instead of offering a picker;
- moving an existing entry into the group rewrites it to the pin;
- the last-resort protocol on the save paths that do not probe (set-default, set-vision-proxy,
  remove) is the pin, and protocol detection is skipped entirely — the group already knows;
- the API-key env hint resolves against the pin, so `deepseek-ai/DeepSeek-V4-Pro` in this group
  reports `OPENAI_API_KEY` and not the DeepSeek variable its id would otherwise route to;
- `penguin config model add --provider vllm` defaults a new entry to the pin.

The pin is load-bearing on the preset rows too: `Qwen/*` matches none of AgentHub's routing
rules and would be rejected outright, while `deepseek-ai/DeepSeek-V4-*` contains `deepseek-v4`
and would otherwise reach DeepSeek's first-party client, pointed at a vLLM server.

## The AgentHub dependency moves to 0.4.10

`openai-chat-vllm-adapter` first ships in `@prismshadow/agenthub` 0.4.10 (agenthub
[#197](https://github.com/Prism-Shadow/agenthub/pull/197),
[#198](https://github.com/Prism-Shadow/agenthub/pull/198)), so `packages/core` and
`packages/cli` move from `^0.4.9` to `^0.4.10`. On 0.4.9 a model in this group would have
failed at request time with AgentHub's `"openai-chat-vllm-adapter is not supported"`, because
the client type did not exist there. The `minimumReleaseAgeExclude` entry in
`pnpm-workspace.yaml` moves to the new version, as its comment prescribes.
