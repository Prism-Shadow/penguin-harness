# A run stopped by tool-loop detection keeps its tool outputs for the next run

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1259](https://github.com/Prism-Shadow/penguin-harness/pull/1259)

[中文版](2026-10-20-tool-loop-carry-over.zh.md)

The `tool_loop` cutoff stopped the run without preserving the loop-stopping turn's tool outputs (or the background notices and steering delivered for its next input). The stateful history then ended on unanswered tool calls, so the next run's request was rejected by the provider (`No tool output found for function call`) — and stayed rejected on every retry, wedging the session.

## What it does

The cutoff now holds `[...stashed, ...turn.toolOutputs, ...injected]` as carry-over — exactly the assembly the next input would have used — so the next run resends them merged with the user's message and the tool calls stay paired with their outputs.
