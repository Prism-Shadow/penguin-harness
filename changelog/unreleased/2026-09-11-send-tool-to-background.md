# A running tool call can be moved to the background from its card

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#691](https://github.com/Prism-Shadow/penguin-harness/pull/691)

[中文版](2026-09-11-send-tool-to-background.zh.md)

While an `exec_command` or `run_subagent` call is executing, its row in the conversation now
carries a "Send to background" action that hands the work back as a background task: the call
closes with a `process_id` / `subagent_id`, nothing is killed, and the turn continues instead of
waiting out the command. The completion arrives later as the usual background-task notice, the
way a `run_in_background` launch reports, and the detached process shows up in the session's
process list with its Stop and Remove actions.

## Details

- Core gives each executing tool call a detach channel of its own, separate from the run's abort
  signal, and `Session.detachToolCall(toolCallId)` fires it. A detach is not an interruption: the
  call ends `completed` with a handle and no interruption marker, and only the two tools with a
  background form observe it — every other tool behaves exactly as before.
- A detached `run_subagent` child inherits the launching call's approval sink and live message
  tap, so it keeps running and streaming after the turn that started it has ended.
- New route `POST /api/sessions/:sessionId/tool-calls/:toolCallId/background` — 204 on success,
  404 `tool_call_not_found` when nothing with that id is executing, 409 `tool_not_detachable`
  when the tool has no background form.
- The action is inline text on the row, styled as a link and sized like the rest of the row, so
  a row carrying it measures exactly like one that does not. It is offered only while the call
  is executing, only on a main-session card, and not on a call already launched with
  `run_in_background` — that one's work is already parked.
- The tool card wears the background mark once a call has been moved there, read from the note
  the call returned, so it survives a reload.
- The chat header's background-task reading is now spelled in words ("2 background tasks")
  instead of drawn as the activity glyph.
