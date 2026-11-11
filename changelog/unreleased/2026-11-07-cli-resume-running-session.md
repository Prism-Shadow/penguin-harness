# `penguin chat` follows every run of its Session, one still running included

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `cli`, `server`, `docs`
- **PR:** [#1503](https://github.com/Prism-Shadow/penguin-harness/pull/1503)

[中文版](2026-11-07-cli-resume-running-session.zh.md)

`penguin chat --resume` on a Session whose Task is still running no longer answers the next message with `409 task_in_progress`. That happened, for example, when the terminal that started the Task had been closed. The chat now holds one subscription to its Session and shows every run on it, whoever started it. On resume it shows the history, then the run so far, follows the run to its end, and then gives the prompt back. A run another surface starts while the chat waits at its prompt is shown the same way, its input included. While a run is shown, typing steers it, Ctrl-C stops it, an approval it waits on is asked in the chat, and `/exit` leaves the chat while the run goes on.

The server now does the joining. `GET /api/sessions/:id/messages?live=run` answers the history up to the current run together with that run's records as they were streamed, deltas folded, so a client shows each record once without comparing anything. `POST /api/sessions/:id/tasks` takes `steerIfBusy`: in one request, an idle Session starts the Task, a running Task takes the input as steering, and a compaction queues it. Against a server without them, the chat says to upgrade it.
