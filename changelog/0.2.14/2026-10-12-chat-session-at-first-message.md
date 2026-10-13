# `penguin chat` creates its Session at the first message

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#1037](https://github.com/Prism-Shadow/penguin-harness/pull/1037)

[中文版](2026-10-12-chat-session-at-first-message.zh.md)

A new `penguin chat` no longer creates a Session when it starts. It creates one when the first message is sent, so a chat opened and left at once leaves nothing on the server: no Session, no Trace, no sidebar entry.

## Details

- Before the first message, the banner shows the agent, the Workspace and the model the Session will have (the Project's default model, read from the server, when the chat names none) and a line saying the conversation is created by the first message.
- `/thinking <level>` and `/switch-model <provider> <model_id>` typed before the first message set what the Session is created with; bare `/thinking` and `/switch-model` show those values. `/compact` and `/clear` say there is no conversation yet, and a malformed `/goal` creates nothing.
- `/clear` no longer creates the replacement Session itself: the next message creates it, with the same Workspace, model, approval mode and thinking level.
- When creating the Session fails, for example because the server is down or a sign-in has lapsed, the error is shown and the message is kept: on a terminal it goes back into the input line, and from a pipe an empty line sends it again.
- `--resume` and `penguin run` are unchanged.
- The CLI reference describes when a chat's Session is created.
