# `penguin chat` picks up a Session that is still running

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `cli`, `docs`
- **PR:** [#1503](https://github.com/Prism-Shadow/penguin-harness/pull/1503)

[中文版](2026-11-07-cli-resume-running-session.zh.md)

`penguin chat --resume` on a Session whose Task is still running no longer answers the next message with `409 task_in_progress`. That happened, for example, when the terminal that started the Task had been closed. The chat now picks the Task up where it is. It shows the history and the reply streamed so far, follows the Task until it ends, and then gives the prompt back. Meanwhile typing steers the Task, Ctrl-C stops it, and an approval the Task is waiting on is asked in the chat. Output the stream repeats from the history is shown once, and the summary of a compaction in progress stays off the screen, as it does in a chat's own turns.

A message sent while the Session runs a Task started elsewhere, in the Web App or another terminal, steers that Task. The chat prints what that Task has done so far and follows it the same way. If the Task has just ended, the message runs as a Task of its own.
