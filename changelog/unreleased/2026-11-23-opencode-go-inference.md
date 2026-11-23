# OpenCode Go uses its native model endpoints

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `core`, `server`, `docs`

[中文版](2026-11-23-opencode-go-inference.zh.md)

New OpenCode Go presets use the model IDs and native protocols published by the Go gateway. Gemini 4 Argon uses Google Interactions, including streamed tool calls. The Chat Completions, Responses and Messages presets use the corresponding Go inference endpoints.
