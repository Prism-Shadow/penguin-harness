# Per-model fast mode

Model entries gain an optional fast-mode setting (AgentHub 0.4.2's UniConfig `fast_mode`): when enabled, that model's session requests opt into the provider's faster serving tier at premium pricing — OpenAI-protocol clients send `service_tier: "priority"`, Anthropic-protocol clients send `speed: "fast"` with the fast-mode beta header. Default off; only `true` is ever persisted (`fast_mode = true` on the entry), so existing configs are untouched. The setting is offered only where it can actually be served, and enabling it warns about the premium billing first.

## Core

`fastModeProtocol(modelId, clientType?, baseUrl?)` (`state/model-catalog.ts`, beside `resolveModelEnv`) answers whether a model can carry fast mode at all and on which protocol — `"openai"` for the clients that send `service_tier`, `"anthropic"` for those that send `speed`, `undefined` for the rest. It mirrors AgentHub's `AutoLLMClient` branch order rather than listing models, so catalog rows added later inherit the right answer: routing reads `client_type` or, when unset, the model id (which does not always agree with the provider group), and the two claude5 carve-outs — a `bedrock://` base URL and any id containing `4-6` — are checked against the raw entry, matching the client. Ids AgentHub cannot route report `undefined` too: no client, no fast tier.

`ModelEntry.fast_mode` flows through `GenerativeModelConfig.fastMode` into `buildUniConfig`, which sets `UniConfig.fast_mode` only when enabled — the key stays off the wire otherwise. It rides the session LLM (compaction rebuilds included); the bare/meta LLM (title generation) and the `describe_image` vision describer deliberately skip it: background requests gain nothing user-facing from a premium tier, and they keep working while the annotation is enabled on a model that rejects it.

Runtime safety: AgentHub clients without a fast tier (Gemini, GLM, Kimi, DeepSeek, `openai_embedding`, and claude5 on Bedrock or Claude 4.6 ids) throw `UnsupportedParameterError` before any network I/O. `GenerativeModel` detects that one deterministic rejection (scoped to `parameter === "fast_mode"`, and only when its own config enabled fast mode) and reports `failed` with a new `LLMOutcome.permanent: true` hint plus an actionable message ("… turn it off in the model settings …"). The engine aborts the run immediately on a permanent failed — same terminal handling as `auth`, but without gating input — instead of burning the ~60s reconnect ladder on a request that can never succeed; no retry countdown is announced for it. Every other failure keeps the retry-everything-but-auth policy unchanged.

## Server

`ModelInfo` / `ModelUpdateEntry` gain `fastMode` (GET reports `true` only when annotated; PUT persists only `true` — omitted or `false` clears the annotation under the full-table replace semantics). `POST /models/test` accepts a `fastMode` override, falling back to the stored annotation, so the connectivity test exercises exactly the serving tier sessions would use and surfaces a fast-mode rejection before saving.

## Web App

The model dialog gains a "Fast mode" toggle (default off), shown only for models whose routed AgentHub client can serve it (`fastModeState`, recomputed from the live form so editing the id, protocol or base URL updates it as it is typed): same inline-switch shape as the vision toggle, with a hint line while ON (and as the label's hover title) saying it is faster output at premium pricing and that the recorded prices stay standard.

Switching it **on** raises a confirmation first (the shared `ConfirmModal`, stacked on the dialog like the save/remove ones): premium billing — MiniMax at 1.5x standard, separate premium price lists at OpenAI and Anthropic — plus the note that the entry's recorded per-token prices do not follow, so the Cost center under-reports the usage; Anthropic-protocol models add that fast mode there is a limited research preview returning 429 until the organization is granted access. Switching it **off** stays one click, because that is the documented escape from a model that rejects the parameter — which is also why a row that already stores `fast_mode = true` keeps its switch even where the rule would not have offered one, marked unsupported.

A model with fast mode on is badged in the model list. The connectivity test always sends the form's current toggle state. Catalog sync treats fast mode as user-owned (never clobbered), and strings ship in both locales.

## CLI

`penguin config model add` gains tri-state `--fast-mode` / `--no-fast-mode` (neither given keeps the current value; `--no-fast-mode` clears the stored annotation rather than writing `false`). Enabling it on a model whose client rejects the parameter still writes the entry but warns on stderr, naming `--no-fast-mode`: a warning rather than a refusal, since an entry may point at an endpoint whose capability is not visible from the config.

## Docs

The bilingual models page gains a "Fast mode" section: semantics, premium pricing not reflected in the recorded per-token prices, a per-client support table with the routing rule that produces it, the two things the toggle cannot check (Anthropic's research-preview 429, and `CLIENT_TYPE` / `ANTHROPIC_BASE_URL` overriding the entry from the server's environment), and background requests being excluded. The configuration, CLI, web-app, and interfaces pages document the new field, flags, toggle and its confirmation, and `LLMOutcome.permanent`.

## Known limitation

Cost is computed at query time from the entry's single price triple and nothing records the serving tier, so while fast mode is on every cost surface (usage cards, trend, the chat header chip, the trace viewer) under-reports that model's spend. Pricing it correctly needs a per-request tier on the usage records — a model-level multiplier would both re-price history retroactively and over-charge the title/vision requests that deliberately stay on the standard tier — so it is left for a follow-up; the confirmation and the docs say so instead.
