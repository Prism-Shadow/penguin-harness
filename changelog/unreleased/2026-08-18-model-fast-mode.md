# Per-model fast mode

Model entries gain an optional fast-mode setting (AgentHub 0.4.2's UniConfig `fast_mode`): when enabled, that model's session requests opt into the provider's faster serving tier at premium pricing — OpenAI-protocol clients send `service_tier: "priority"`, Anthropic-protocol clients send `speed: "fast"` with the fast-mode beta header. Default off; only `true` is ever persisted (`fast_mode = true` on the entry), so existing configs are untouched.

## Core

`ModelEntry.fast_mode` flows through `GenerativeModelConfig.fastMode` into `buildUniConfig`, which sets `UniConfig.fast_mode` only when enabled — the key stays off the wire otherwise. It rides the session LLM (compaction rebuilds included); the bare/meta LLM (title generation) and the `describe_image` vision describer deliberately skip it: background requests gain nothing user-facing from a premium tier, and they keep working while the annotation is enabled on a model that rejects it.

Runtime safety: AgentHub clients without a fast tier (Gemini, GLM, Kimi, DeepSeek, `openai_embedding`, and claude5 on Bedrock or Claude 4.6 ids) throw `UnsupportedParameterError` before any network I/O. `GenerativeModel` detects that one deterministic rejection (scoped to `parameter === "fast_mode"`, and only when its own config enabled fast mode) and reports `failed` with a new `LLMOutcome.permanent: true` hint plus an actionable message ("… turn it off in the model settings …"). The engine aborts the run immediately on a permanent failed — same terminal handling as `auth`, but without gating input — instead of burning the ~60s reconnect ladder on a request that can never succeed; no retry countdown is announced for it. Every other failure keeps the retry-everything-but-auth policy unchanged.

## Server

`ModelInfo` / `ModelUpdateEntry` gain `fastMode` (GET reports `true` only when annotated; PUT persists only `true` — omitted or `false` clears the annotation under the full-table replace semantics). `POST /models/test` accepts a `fastMode` override, falling back to the stored annotation, so the connectivity test exercises exactly the serving tier sessions would use and surfaces a fast-mode rejection before saving.

## Web App

The model dialog gains a "Fast mode" toggle (default off, every model — the catalog carries no fast-tier capability flag, so none is assumed): same inline-switch shape as the vision toggle, with a hint line while ON (and as the label's hover title) saying it is faster output at premium pricing and that unsupported models reject requests. The connectivity test always sends the form's current toggle state. Catalog sync treats fast mode as user-owned (never clobbered), and strings ship in both locales.

## CLI

`penguin config model add` gains tri-state `--fast-mode` / `--no-fast-mode` (neither given keeps the current value; `--no-fast-mode` clears the stored annotation rather than writing `false`).

## Docs

The bilingual models page gains a "Fast mode" section (semantics, premium pricing not reflected in the recorded per-token prices, per-client rejection behavior, background requests excluded); the configuration, CLI, web-app, and interfaces pages document the new field, flags, toggle, and `LLMOutcome.permanent`.
