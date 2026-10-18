# Runs interrupted by a restart or crash now resume automatically

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `server`, `core`, `cli`, `web`, `docs`
- **PR:** [#1208](https://github.com/Prism-Shadow/penguin-harness/pull/1208)

[中文版](2026-10-18-server-restart-auto-resume.zh.md)

A run in flight when the server restarts — a graceful restart, a crash, or a `kill -9` —
used to strand its Session as `[aborted]: aborted by user`, waiting for someone to send a
message. The next boot now resumes every interrupted run on its own: the Trace replay
reconstructs the cut-off turn (`[turn_aborted]` carry-over) and the run continues from
where it left off.

## Details

- Every driven run (Task, compaction, goal loop, model switch) writes a durable mark under
  `<data root>/session-runs/` when it starts and removes it when it ends — unless the
  server's own shutdown cut it short, in which case the mark survives for the next boot.
  A crash needs no shutdown-time write: the dead process's leftover marks are the resume set.
- Shutdown aborts runs with the server's own `AbortSignal.reason`, which core records as a
  new `server_restart` abort code (rendered "interrupted by a server restart" / "服务重启导致中断")
  instead of `user_abort`. The first abort wins: a run the person already stopped keeps
  `user_abort` even if a shutdown lands while it winds down, and is never resurrected.
- A crash-loop guard skips a Session after three auto-resumes inside an hour (the mark is
  dropped and an `auto_resume_loop` error recorded), so a poison run cannot cost a model
  call on every boot. Any normally-ended run clears the guard.
- Queued follow-ups are in-memory by design and do not survive a restart — only the
  interrupted run itself resumes. Background processes and background subagents from before
  the restart are gone; the resume message tells the model to restart them if still needed.
