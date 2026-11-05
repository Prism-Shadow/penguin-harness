# Agent API session settings and clearer SDK methods

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`, `amsp`, `docs`
- **PR:** [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)
- **Breaking:** yes — the streaming SDK method is now `stream()`; `run()` returns the completed result

[中文版](2026-10-13-agent-api-settings.zh.md)

Added model, thinking level and workspace choices to the Agent API tab using the existing pickers. Each choice saves immediately and applies to newly created API sessions. Moved the approval explanation into the label's question-mark popover.

Added an owner-configurable concurrency limit (default 4), with HTTP 429 and Retry-After when full. Concurrent starts reserve capacity before creating a session, and rejected or failed starts leave that capacity available. Added documentation and copy-for-Agent prompt buttons above the examples.

## SDK methods

Renamed the streaming `AgentClient.run()` to `stream()` and the result-returning `ask()` to `run()`. Updated the examples, SDK reference and client tests. Raised the bundled `penguin-sdk` skill version so installed copies can receive the updated API reference.

## Compatibility

Replace old streaming `client.run(...)` calls with `client.stream(...)`, and `client.ask(...)` calls with `await client.run(...)`. Existing sessions keep their settings. Database upgrades preserve API settings and keys as described in [backward compatibility](2026-10-13-backward-compatibility.md).
