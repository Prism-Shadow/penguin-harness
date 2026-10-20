# A history left on unanswered tool calls is paired before the next request

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`

[中文版](2026-10-20-unpaired-tool-call-repair.zh.md)

A request that fails leaves the provider client's history exactly as it was before it: MMSP commits a turn's messages only when the stream's `stop` event arrives, so the input of a failed request — the tool outputs meant to answer the model's committed `tool_calls` — never lands. The history then ends on an assistant turn whose `tool_calls` have no result, and **every later request is refused** by the provider (`An assistant message with 'tool_calls' must be followed by a tool message answering each call`). The session is wedged, and no retry helps: the identical request is refused the same way, and the engine has no way to reach the LLM history that holds the unpaired calls.

## What it does

Before every request, `GenerativeModel` looks at the client history for `tool_calls` that no `tool_result` answers, and sends a placeholder result for each — the repair has to reach the history itself, and a tool result sent as the request's input is what the provider pairs with the committed assistant turn.

The placeholder says the tool produced no result (`[no result: the request that ran this tool failed before its output was recorded — treat the tool as not run]`), so the model cannot read the pairing as a successful run and is free to re-issue the call.

Ids that the request's own input already answers are left alone: when the engine holds the real outputs it resends them as carry-over (the `tool_loop` cutoff keeps them for the next run), and a second result for the same call would be refused as a duplicate.
