# Models and core: request hygiene, prompt guardrails, and runtime settings

## Empty tool lists stay off the wire

Strict OpenAI-compatible servers reject requests that carry `tools: []` — vLLM answers `400 … tools must not be an empty array. Either provide at least one tool or omit the field entirely.` Every tool-less request the harness makes (the Models-page connectivity probe, session-title generation, the vision describer) hit this against a local vLLM endpoint.

- `buildUniConfig` now omits the `tools` field entirely when the tool list is empty, instead of sending an empty array. Tool-carrying agent requests are unchanged.
- `tool_choice` was investigated end to end: neither this repo nor AgentHub 0.4.0 ever sends it. The `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser` failure seen on vLLM is produced server-side when a non-empty `tools` array arrives without those flags — real tool use on vLLM needs them regardless of client (the vllm skill documents this). A wire-level capture test now locks both behaviors: no `tools` key and no `tool_choice` key on a tool-less request.

## Reserved-port and API-key guardrails in the default system prompt

Agents occasionally freed a busy port by killing its listener — sometimes the harness's own services. The default server port now has a single source: core's internal `ports.ts` exports `DEFAULT_SERVER_PORT`, narrowly re-exported from the package barrel for the CLI and server to derive their defaults from (still runtime-overridable via `--port` / `PORT`). The prompt rule deliberately carries no hardcoded numbers: never kill a process you did not start — including PenguinHarness's own services — never take a harness service port for your own servers, and when a wanted port is busy, pick another free port instead of killing the listener.

On an API authentication/authorization or API-key error (401/403, invalid or missing key), the agent retries at most once; if the error persists it stops calling tools and asks the user to update the key in the agent's vault or the model settings outside the chat — secret values never belong in the conversation. Updated secrets only take effect in the next conversation, so further retries cannot succeed — the prompt says so.

The default prompt is a seed for each agent's editable `system_config.yaml`: existing agents keep their current prompt; new agents get the rules.

## Max output tokens is a per-model setting

A model with a 32k context served locally rejected requests outright — `400 This model's maximum context length is 32768 tokens. However, you requested 32000 output tokens…` — and took session-title generation down with it. The Models page (and `penguin config model add --max-tokens`) now accepts a per-model max output tokens cap, stored on the model entry and applied ahead of the agent-level default; out-of-band requests (title generation, vision description) respect it too, taking the smaller of their own cap and the model's. Unset means today's behavior.

## Thinking level moves to the conversation

The thinking level is no longer a Models-page annotation. The default lives in Agent settings (where it always was), and the chat draft gains a compact titled picker next to the model selector offering `low` / `medium` / `high` / `xhigh` — `none` is no longer offered because many models cannot disable thinking, though it remains a valid stored value that still displays correctly. Changing the picker writes through to the Agent settings immediately, so the session created on send — and every later one — uses the new level. The draft's model choice now carries over the same way: after a successful send it becomes the next conversation's default.

## Subagents follow the parent session

`run_subagent` with the model pair omitted used to fall through to the Project default model, and a child always ran at its own Agent's thinking level. A spawned subagent now inherits the parent session's resolved `(provider, model_id)` pair and its effective thinking level (workspace was already inherited); an explicit complete pair in the tool call still wins, and half a pair is still rejected rather than completed from the parent's half. The pass-down is tri-state, so a parent with no thinking level produces a child with none — the child's own config never sneaks back in — and resuming a session restores the thinking level its Trace recorded instead of re-reading the Agent config.

## Sessions carry their origin

`session_meta` gains an optional `source` field (`"subagent" | "schedule"`, absent = user-created) written at creation, preserved across resume and compaction-driven trace rotation, and treated as the single source of truth: the server derives the session index's origin from the meta (registering children from the forwarded meta, adopting discovered traces, lazily reading the trace head for rows indexed by an earlier process) and no longer stores the type in the database.

## Session-title generation is internal

`session-title.ts` moved into core's `internal/` module. `Session.generateTitle()` remains the public entry point, and `SessionTitleResult`, `stripConversationMarkers` and `sanitizeTitle` (both used by the server's fallback title path) stay importable from the package barrel; the LLM-driving internals (`buildTitlePrompt`, `generateTitleWithLLM`) are no longer part of the public surface.
