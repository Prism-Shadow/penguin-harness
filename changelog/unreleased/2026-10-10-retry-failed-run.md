# A failed run has a Retry button

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[中文版](2026-10-10-retry-failed-run.zh.md)

When a run ended on a fatal error or after the automatic retries ran out, the chat showed only the error. The failed turn's input was held for the next message, but the only way to send it again was to type something. The error line now offers **Retry**.

- `POST /api/sessions/:id/retry` starts a Task with empty input. The engine sends the held input alone: no new user message, no new input record in the Trace, no user-prompt hook consult. It answers `409 nothing_to_retry` when nothing is held, for example because a later message already sent it.
- The Web App shows **Retry** on the error line and on a retry line that gave up, when that line is the last thing in the conversation and the session is idle. It works after a restart too, since resuming the Session rebuilds the held input from the Trace. After fixing the cause, such as updating an API key, Retry continues the conversation without retyping.
