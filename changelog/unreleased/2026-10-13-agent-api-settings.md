# Agent API session settings and clearer SDK methods

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`, `amsp`, `docs`
- **Breaking:** yes — the streaming SDK method is now `stream()`; `run()` returns the completed result

[中文版](2026-10-13-agent-api-settings.zh.md)

Added model, thinking level and workspace choices to the Agent API tab using the existing pickers. Each choice saves immediately and applies to newly created API sessions. Moved the approval explanation into the label's question-mark popover.

## SDK methods

Renamed the streaming `AgentClient.run()` to `stream()` and the result-returning `ask()` to `run()`. Updated the examples, SDK reference and client tests.

## Compatibility

Replace old streaming `client.run(...)` calls with `client.stream(...)`, and `client.ask(...)` calls with `await client.run(...)`. Existing sessions keep their settings. Database upgrades preserve API settings and keys as described in [backward compatibility](2026-10-13-backward-compatibility.md).
