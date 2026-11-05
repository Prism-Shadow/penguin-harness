# A stopped run has a Retry button

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `web`, `server`, `docs`, `ui-gallery`
- **PR:** [#1097](https://github.com/Prism-Shadow/penguin-harness/pull/1097)

[中文版](2026-10-13-retry-after-stop.zh.md)

The **Retry** that a failed run's last line offers now also appears on the "[Aborted]" line left when the user presses **Stop**. It sends the stopped turn again without a new message.

## Details

- The engine already held a stopped turn for the next run, the same way it holds a failed one: the original input together with whatever the model had already written, or the outputs of the tool calls it had already made. Retry starts a Task with empty input through the existing `POST /api/sessions/:id/retry`, so the held turn goes out on its own. The transcript gains no user message and the Trace no input record.
- The button shows only while the "[Aborted]" line is the last thing in the conversation and the session is idle, and it goes away as soon as anything newer arrives. When nothing is held, for example because a later message already sent the turn, the toast now says "Nothing to retry: that turn's input has already been sent."
- In the chat, the retried run opens a Task of its own, with its own stats row, both live and when the history is rebuilt.
- The component gallery's demo answers Retry after a stop by replaying its scripted reply.
