# Switch models while Slides is starting a conversation

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `use-bento-slides`, `server`

[中文版](2026-11-23-slides-model-handoff.zh.md)

AI Slides keeps the selected model when the first message has reached the host and its reply is still in transit. Confirming a change hands off the deck’s existing conversation. The model selector displays the accepted target, including when reopening the deck during a handoff. If the handoff fails, the selector returns to the active model and reports the failure.
