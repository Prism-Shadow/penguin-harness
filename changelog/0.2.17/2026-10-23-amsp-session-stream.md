# AMSP v1 carries the Session's own records, and the SDK reads them

- **Date:** 2026-10-23
- **Type:** feature
- **Scope:** `amsp`, `server`, `core`, `web`, `docs`
- **PR:** [#1301](https://github.com/Prism-Shadow/penguin-harness/pull/1301), [#1308](https://github.com/Prism-Shadow/penguin-harness/pull/1308)
- **Breaking:** yes — `/api/amsp/v1` keeps its path, but its stream changes shape: `run.*`, `K.delta` and `K.done` events give way to the Session's records, and the `@prismshadow/amsp` client of 0.2.16 and earlier cannot read it. The SDK of this release, which a `^0.2.16` dependency picks up, cannot read an older server's stream.

[中文版](2026-10-23-amsp-session-stream.zh.md)

The Agent API streams a Session as its Trace holds it. Every record is the envelope the Trace stores, untranslated, plus the `partial_*` fragments and the `ping` heartbeat. The SDK reads and follows those records, and the API gains the routes a program needs to follow a Session it did not start.

## The stream

- A record is an unnamed SSE event with an `id:` and the envelope `{timestamp, type, payload, origin?}`. The control frames are `event: ping` (`{}`, at once and every 20 s, replacing `: keep-alive`) and a run stream's closing `data: [DONE]`.
- A run stream is `ping`, then the run's records from its first main-Session record, then `[DONE]` once the Session is idle again. On a new Session's first message, the Session's `session_meta` comes first, before `task_begin` and the input, and its `session_id` names the new Session; later messages carry none, and a run that continues a Session is on the `session_id` its request sent.
- The Web App's server events (`task_state`, `approval_request`, `session_title`, `goal_*` …) never appear on an AMSP entry. A run that did not reach its end leaves its last `task_begin` unclosed before `[DONE]`; there is no error frame.

## Routes

- On the key door, beside `runs`, the Session and abort: `GET sessions/:id/stream`, a Session stream that resumes from `Last-Event-ID`, or, when that id has left the buffer or the server restarted, answers `409` `resync_required` in JSON before any stream; `GET sessions/:id/messages` and `GET sessions/:id/trace-image`, the Web App's history handlers, whose image references point at the key door; `GET sessions/:id/approvals[?wait=1–60]`, the calls waiting on a decision, long-polled; and `POST sessions/:id/tasks`, a run that does not hold the connection (202, 409 when busy, never queued).
- On the cookie door, `GET /api/sessions/:id/amsp` is the same Session stream for a signed-in reader, and `GET /api/sessions/:id/approvals` the same approvals resource. `/api/sessions/:id/stream` is unchanged.
- The translator from records to v1 events is gone.

## Core

- A Session streams every `session_meta` it writes, once: its first, ahead of the first Task's `task_begin`; and a compaction's new context's, when its file opens behind the next Task's `task_begin`, ahead of that Task's input. A model switch streamed its meta already.
- `Session.contextOpenPending()` says when the next Task opens a new file; the server holds a run's input echo behind that `session_meta`.
- The parent's stream still carries a subagent's `session_meta` once.

## SDK `@prismshadow/amsp`

- The SDK ships in this release at the harness version, as every package does. `AgentClient.stream()` and `AgentClient.run()` keep their 0.2.16 meaning: `stream()` returns the run to iterate, `run()` the result alone. `RunResult` is read from the records: `status` and `error`, `text`, `usage`, `sessionUsage` and `requests`.
- The approval loop long-polls the approvals resource while a `tool_call` waits on its decision, and hands each call to `onApproval(toolCall, origin)`; with no callback the answer is `deny`.
- New: `messages()`, `approvals()`, `SessionReader` (history, then the live tail, deduplicated, reconnected after 50 s of silence, and started over when a reconnect is refused `resync_required`), `HttpTransport` and the `Transport` interface, `readSse` with event names and ids, `readAmsp`, and a browser bundle at `dist/browser/amsp.js`.

## Web App

- The API tab's Try it runs through the SDK. Rows are labelled by the record's `payload.type`, a message's fragments and its complete record are one row, and `ping` is not listed. Allow and Deny sit on the waiting `tool_call`'s row. The outcome strip is the run's `RunResult`, or says that the stream ended before `[DONE]` or that the run did not reach its end.
- The tab's SDK example iterates `stream()`.

## Compatibility

- `/api/amsp/v1` keeps its path but its stream changes shape in this release, which keeps the 0.2 line (user decision 2026-10-23). The `@prismshadow/amsp` client of 0.2.16 and earlier, and any program that parses the `run.*` / `K.delta` / `K.done` events, must move to this release's SDK or read the records.
- The SDK is versioned with the harness, so a dependency on `^0.2.16` picks up the breaking client on its next install or update. A program that has not moved yet pins `@prismshadow/amsp@0.2.16`, which keeps working against a server of 0.2.16 or earlier.
- This release's SDK cannot read an older server's stream either: upgrade the server and the client together.
- The amsp docs page maps every v1 event to the record that replaces it.
- No compatibility layer is kept (user decision 2026-10-23).
