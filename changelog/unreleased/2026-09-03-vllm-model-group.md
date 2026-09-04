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

These are self-hosted, which is what the group's shape follows from. The rows carry **no
pricing** — the user runs the server, so there is no seller and no rate, and the field stays
absent rather than zeroed, since three zero buckets are a genuine free tier. They carry **no
base URL** either: every deployment has its own, so the user supplies it as in the Custom
group. Context windows are each model's native length as documented at `recipes.vllm.ai`
(262,144 for the Qwen rows, 1,000,000 for the DeepSeek V4 rows); a deployment started with a
smaller `--max-model-len` serves less, and the entry's context window is editable.

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

## Requires an AgentHub release that carries the client

`openai-chat-vllm-adapter` does not exist in `@prismshadow/agenthub` 0.4.9, the version this
repo depends on and the newest published release; it is on AgentHub's unreleased branch
(agenthub [#197](https://github.com/Prism-Shadow/agenthub/pull/197),
[#198](https://github.com/Prism-Shadow/agenthub/pull/198)). Until the dependency is bumped to
the release that contains it — 0.4.10 or later — a model in this group fails at request time
with AgentHub's `"openai-chat-vllm-adapter is not supported"`.
