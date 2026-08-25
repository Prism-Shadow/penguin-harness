# A stopped background command is reported as stopped, not as a failure

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `core`, `web`, `docs`
- **PR:** [#PRNUM](https://github.com/Prism-Shadow/penguin-harness/pull/PRNUM)

[中文版](2026-08-24-background-stop-status.zh.md)

A `run_in_background` command that ended on a SIGTERM reached the conversation as
`Background command failed: … — terminated by signal SIGTERM`. A SIGTERM is almost always
somebody stopping the process on purpose, and the model's reasonable response to a failed
dev server is to start it again — undoing the stop that was just asked for. The report is
still sent, with the wording it should have had.

## Details

- A command ended on purpose now reports the new `status: stopped`: the user's **Stop**
  button in the Web App's process list, a stop signal that arrived from outside
  (`SIGTERM`/`SIGINT`/`SIGHUP` — a Ctrl-C from a terminal sharing the process group, a
  `pkill`, a supervisor shutting a dev server down), and a stop the harness forced (a
  capacity eviction, an idle reap).
- The notice reads `Background command stopped: … — stopped by SIGTERM`, and its
  `[background_task_done]` block states in as many words that the process was ended on
  purpose and must not be restarted unasked.
- `failed` keeps the outcomes nobody asked for — a spawn error, a non-zero exit, a hard kill
  or a fault signal — so an OOM kill still reads as the failure it is.
- `input_command`'s `kill` on an already-exited process describes a stop signal the same way
  ("stopped by SIGTERM" rather than "terminated by signal SIGTERM").
- The Web App's notice card carries the third outcome: "Background command stopped", with a
  muted square glyph instead of the red failure X.
