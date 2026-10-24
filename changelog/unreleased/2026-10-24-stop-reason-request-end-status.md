# Records carry no stop_reason: a Request's end is request_end.status

- **Date:** 2026-10-24
- **Type:** refactor
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`
- **PR:** [#1309](https://github.com/Prism-Shadow/penguin-harness/pull/1309)
- **Breaking:** yes — no record carries `stop_reason` any more; `request_end.status` gained `truncated`, every `tool_call_output` carries a required `status`, and the turn cap ends a Task with an `abort` record.

[中文版](2026-10-24-stop-reason-request-end-status.zh.md)

The `stop_reason` field left every AMSP record. A Request's end reason is recorded once, as `request_end.status`; a tool result says what it is in its own `status`; the turn cap is an `abort` record. The decision is [PRFC-0022](https://github.com/Prism-Shadow/penguin-harness-design/pull/374).

## Details

- `request_end.status` is a `RequestEndStatus`: the four `StopReason` values plus `truncated`, which `@prismshadow/amsp` exports. `StopReason` itself is unchanged and stays the type of `compaction_end` and the MCP connect results.
- A response the provider did not finish the normal way (`finish_reason` `length` at the output cap, or `unknown`) ends `truncated` instead of committing with a `fatal` last item. `GenerativeModel` takes the turn back out of MMSP's history but still emits its `token_usage` (the provider billed it, so the cost center meters it; it counts as no Session turn and adds no failure row), and the engine retries it on the reconnect ladder with the finish reason on the `[request_error]` line. A truncated attempt does not reset the ladder, so consecutive truncations exhaust `maxReconnects`; the last `request_end` (`truncated`, no `retry_in_ms`) then ends the run, as an exhausted `retryable` does. A truncated compaction request counts toward the compaction's retry budget.
- One-shot requests read a truncated answer like a completed one: the session title, `read_file`'s vision model, the model probe and the vision probe.
- `tool_call_output.status` is required: `completed`, `fatal`, or `aborted`, which now means the call was denied and never ran. `retryable` left the tool vocabulary. A tool's `ToolResult.stopReason` became `ToolResult.status` (`ToolStatus`), and the builder `toolCallOutput` takes `status`. `partial_*` records carry no status.
- A Task that reaches `max_turns` ends with an `abort` record (`error_code: "max_turns"`, `error_message` `reached max turns (N)`) instead of a `fatal` assistant notice. The run's `RunCutoff` carries the same code. The Web App and the CLI show it as "[Stopped]: reached the maximum turns per task", with Retry on the Web App's line.
- A tool call the stream cut short (its arguments never fully arrived) closes with its `partial_tool_call` stop and writes no complete `tool_call`. Every complete `tool_call` is dispatched.
- The record builders lost their stop-reason parameters: `assistantText(text, fidelity?)`, `thinkingMessage(thinking, fidelity?)`, `textMessage(role, text, fidelity?)`, `partialText(eventType, text?)`, `partialThinking(eventType, thinking?)`, and `toolCall` / `partialToolCall` / `partialToolCallOutput` without `stopReason`. `abortEvent` takes an optional `errorMessage`.
- SDK `RunResult`: an `abort` is `aborted` (the turn cap's with code `max_turns`), a terminal `request_end` may be `truncated`, the rule that read a `fatal` last assistant text is gone, and `text` holds only the assistant text of Requests that completed.
- The Web App dropped the `[stop reason]` badges after replies and thinking, settles a cut-short call's card as aborted when its Request ends, shows a retry line for `truncated`, and reads a reply's fork point from whether its Request completed. The Trace view's badge and timeline show the record's `status`, and the Trace analysis DTOs' `stopReason` fields became `status`.
- The cost center's error table records an exhausted `truncated` as `llm_failed` and a retried one as `llm_retried`; tool failures are always `tool_fatal:<tool>`.
- The goal and continual-learning hooks read the new shape (hook versions `2026.10.23.1`), and the penguin-sdk skill lists `truncated` among the statuses.
- The records, AMSP, Agent API, agent-loop, message-flow, interfaces, tools, architecture and sessions-and-traces docs pages follow the new shape; the records page's `stop_reason` section became "End reasons".

## Compatibility

- **API callers**: stop reading `stop_reason`. Read a Request's end from its `request_end.status` (which may now be `truncated`), a tool result's from `tool_call_output.status`, and the turn cap from an `abort` with `error_code: "max_turns"`. A `RunResult.status` can be `truncated`, and the turn cap is `aborted` rather than `fatal`.
- **Code built on core**: drop the stop-reason argument from the record builders, pass `status` to `toolCallOutput`, and return `{ status }` instead of `{ stopReason }` from a tool's `execute`.
- **Trace readers**: Traces written before this release keep `stop_reason` on their records; it is no longer read. A `tool_call_output` without `status` reads as `completed`, so an old failed, denied or interrupted tool result may show as completed. Resuming an old Trace is unaffected: replay already commits a turn only by its `request_end.status`. Nothing is migrated, and no compatibility code reads the old field.
