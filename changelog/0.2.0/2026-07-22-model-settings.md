# Per-model output cap, conversation-time thinking level, and title generation internals

## Max output tokens is a per-model setting

A model with a 32k context served locally rejected requests outright — `400 This model's maximum context length is 32768 tokens. However, you requested 32000 output tokens…` — and took session-title generation down with it. The Models page (and `penguin config model add --max-tokens`) now accepts a per-model max output tokens cap, stored on the model entry and applied ahead of the agent-level default; out-of-band requests (title generation, vision description) respect it too, taking the smaller of their own cap and the model's. Unset means today's behavior.

## Thinking level moves to the conversation

The thinking level is no longer a Models-page annotation. The default lives in Agent settings (where it always was), and the chat draft gains a compact picker next to the model selector: changing it writes through to the Agent settings immediately, so the session created on send — and every later one — uses the new level. Values stay `none / low / medium / high / xhigh`, with an inherit-provider-default option.

## Session-title generation is internal

`session-title.ts` moved into core's `internal/` module. `Session.generateTitle()` remains the public entry point, and `SessionTitleResult` plus `stripConversationMarkers` (used by the server's fallback title) stay importable from the package barrel; the LLM-driving internals (`buildTitlePrompt`, `generateTitleWithLLM`, `sanitizeTitle`) are no longer part of the public surface.
