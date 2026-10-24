# Interrupted items leave no complete record

- **Date:** 2026-10-24
- **Type:** refactor
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1310](https://github.com/Prism-Shadow/penguin-harness/pull/1310)
- **Breaking:** yes — an item cut short writes no complete record: a text or thinking an interruption cut off, and the output of a tool call interrupted while it ran.

[中文版](2026-10-24-interrupted-items-leave-no-record.zh.md)

An item that did not run to its end no longer writes a complete record. Its fragments still stream live and close with their `stop`, and the `request_end` and `abort` that follow say how the Request and the run ended. This finishes what [#1309](https://github.com/Prism-Shadow/penguin-harness/pull/1309) began for a tool call the stream cut short. The decision is [PRFC-0022](https://github.com/Prism-Shadow/penguin-harness-design/pull/374).

## Details

- `GenerativeModel` closes the text or thinking item still streaming when a request is interrupted, fails or drops with its partial `stop` alone. An item whose done item arrived is still written, so a truncated response keeps its records.
- The Environment closes a tool call the user interrupted while it ran with its fragments, the `[interrupted: tool aborted by user]` note among them, and its partial `stop`; it writes no `tool_call_output`. A call that ends any other way still writes one.
- The engine pairs such a call for the next request with an output it never streams or writes: what the call had streamed, ending in the note. The carry-over blocks (`[turn_aborted]`, `[turn_retried]`) still carry the text or thinking the interruption cut off, rebuilt from its fragments. Resuming a Session pairs the call with the replay's placeholder, as before.
- The Web App stops waiting for the complete record of a text or thinking once its Request ends, so the live view keeps what streamed; after a reload an interrupted reply is no longer shown, and the stop marker still is. The gallery's mock streams and history follow.
- The Trace analysis closes the span of a call interrupted while it ran at the `abort`, as `aborted`.
- The records, AMSP, agent-loop, message-flow and tools docs pages describe the new shape.

## Compatibility

- **API callers and Trace readers**: an interrupted text, thinking or running tool call has fragments on the live stream and no complete record. Read the `request_end.status` and the `abort` that follow to learn that a Request or a run was cut short; a `tool_call` without a `tool_call_output` is a call that was interrupted while it ran (or never dispatched).
- **Code built on core**: an `Environment` implementation's interrupted call may now end without a complete `tool_call_output`; the engine supplies the pairing.
- Traces written before this release keep their interrupted items as complete records, and they are still read as they were written. Nothing is migrated.
