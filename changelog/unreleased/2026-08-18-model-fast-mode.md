# Per-model fast mode

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `model-catalog`
- **PR:** [#326](https://github.com/Prism-Shadow/penguin-harness/pull/326)

[中文版](2026-08-18-model-fast-mode.zh.md)

Model entries gained an optional fast-mode setting that opts a model's session requests into the provider's faster serving tier at premium pricing, carried by AgentHub's UniConfig `fast_mode` (agenthub [#171](https://github.com/Prism-Shadow/agenthub/pull/171)): OpenAI-protocol clients send `service_tier: "priority"`, Anthropic-protocol clients send `speed: "fast"` with the fast-mode beta header. It defaults off and only `true` is ever persisted (`fast_mode = true` on the entry), so existing configs were left untouched. The toggle is offered only on models whose resolved AgentHub client can actually serve fast mode, turning it on asks for confirmation first because of the premium billing, and a model that rejects the parameter anyway fails the run immediately with an actionable message instead of retrying.

## Core

`fastModeProtocol(modelId, clientType?, baseUrl?)` (`state/model-catalog.ts`, beside `resolveModelEnv`) answers whether a model can carry fast mode at all and on which protocol — `"openai"` for the clients that send `service_tier`, `"anthropic"` for those that send `speed`, `undefined` for the rest. It mirrors AgentHub's `AutoLLMClient` branch order rather than listing models, so catalog rows added later inherit the right answer: routing reads `client_type` or, when unset, the model id (which does not always agree with the provider group), and the two claude5 carve-outs — a `bedrock://` base URL and any id containing `4-6` — are checked against the raw entry, matching the client. Ids AgentHub cannot route report `undefined` too: no client, no fast tier.

`ModelEntry.fast_mode` flows through `GenerativeModelConfig.fastMode` into `buildUniConfig`, which sets `UniConfig.fast_mode` only when enabled — the key stays off the wire otherwise. It rides the session LLM, compaction rebuilds included; the bare/meta LLM (title generation) and the `describe_image` vision describer were left off it, so those background requests keep working while the annotation is enabled on a model that rejects it.

AgentHub clients without a fast tier (Gemini, GLM, Kimi, DeepSeek, `openai_embedding`, and claude5 on Bedrock or Claude 4.6 ids) throw `UnsupportedParameterError` before any network I/O. `GenerativeModel` detects that one deterministic rejection — scoped to `parameter === "fast_mode"`, and only when its own config enabled fast mode — and reports `failed` with a new `LLMOutcome.permanent: true` hint plus a message naming the fix ("… turn it off in the model settings …"). The engine aborts the run immediately on a permanent failure, the same terminal handling as `auth` but without gating input, and announces no retry countdown for it. Every other failure keeps the retry-everything-but-auth policy unchanged.

## Server

`ModelInfo` / `ModelUpdateEntry` gained `fastMode`: GET reports `true` only for an annotated entry, and PUT persists only `true`, so an omitted or `false` field clears the annotation under the full-table replace semantics. `POST /models/test` accepts a `fastMode` override that falls back to the stored annotation, so the connectivity test exercises exactly the serving tier sessions would use and surfaces a fast-mode rejection before saving.

## Web App

The model dialog gained a "Fast mode" toggle, default off, rendered only for models whose routed AgentHub client can serve it — `fastModeState` recomputes from the live form, so editing the id, protocol or base URL updates it as it is typed. A custom or user-defined group is resolved through the protocol its entry will be saved with (`protocolForPersist`) rather than by model id, so a group that persists on the compatible client keeps the switch whatever upstream id is typed into it, while preset and vendor groups stay on AgentHub's id routing. It takes the same inline-switch shape as the vision toggle and shares one row with it, in the two-up grid the dialog already uses for the context-window and max-output-tokens fields, with a hint line while ON (and as the label's hover title) saying it is faster output at premium pricing and that the recorded prices stay standard. Neither switch is guaranteed to be present — vision is read-only catalog metadata on preset models and fast mode is withheld wherever the client rejects it — so the row is dropped when neither applies, and whichever one remains spans the full width instead of sitting in a half-width cell (`capabilityRow`).

Switching it **on** raises a confirmation first (the shared `ConfirmModal`, stacked on the dialog like the save and remove ones): the premium billing — MiniMax at 1.5x standard, separate premium price lists at OpenAI and Anthropic — the entry's recorded per-token prices not following it, so the Cost center under-reports the usage, and for Anthropic-protocol models that fast mode there is a limited research preview returning 429 until the organization is granted access. Switching it **off** stays one click, and a row that already stores `fast_mode = true` keeps its switch even where the rule would not have offered one, marked unsupported, so the runtime message's "turn it off in the model settings" holds.

A model with fast mode on is badged in the model list. The connectivity test sends the form's current toggle state, catalog sync treats fast mode as user-owned and never clobbers it, and the strings ship in both locales.

## CLI

`penguin config model add` gained tri-state `--fast-mode` / `--no-fast-mode`: neither flag keeps the current value, and `--no-fast-mode` clears the stored annotation rather than writing `false`. Enabling it on a model whose client rejects the parameter still writes the entry and warns on stderr, naming `--no-fast-mode` — an entry can point at an endpoint whose capability is not visible from the config.

## Docs

The bilingual models page gained a "Fast mode" section: the semantics, the premium pricing that the recorded per-token prices do not reflect, a per-client support table with the routing rule that produces it, the two things the toggle cannot check (Anthropic's research-preview 429, and `CLIENT_TYPE` / `ANTHROPIC_BASE_URL` overriding the entry from the server's environment), and the excluded background requests. The configuration, CLI, web-app and interfaces pages documented the new field, the flags, the toggle and its confirmation, and `LLMOutcome.permanent`.

## Cost reporting

Nothing records the serving tier on a usage record, and cost stays computed at query time from the entry's single price triple, so while fast mode is on every cost surface — usage cards, the trend, the chat header chip, the trace viewer — under-reports that model's spend. Per-tier pricing was left for a follow-up; the confirmation and the models page state the gap instead.
