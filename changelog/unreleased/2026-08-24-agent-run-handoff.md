# A hot swap no longer interrupts running agent Tasks

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#436](https://github.com/Prism-Shadow/penguin-harness/pull/436)

[中文版本](./2026-08-24-agent-run-handoff.zh.md)

A platform hot push used to hard-stop every running agent Task: the LLM stream aborted,
tool subprocesses were killed, pending approvals converged to deny. Now a running Task
survives the swap: its drive keeps running to the next turn boundary and parks there
silently, and the successor App resumes the run from the Trace — the transcript
continues where it left off, with no aborted turn and no redone side effects. Pending
approvals stay answerable and the interrupt keeps working throughout.

## Details

- Each session's run state now lives in a per-session **monitor**
  (`runtime/session-monitor.ts`): status, pending approvals, the interrupt controller,
  queued follow-ups and display mirrors, with every operation serialized at the monitor
  boundary. `SessionManager` holds no per-session state anymore — it is the facade and
  the generation's procedure set the monitor delegates to.
- Monitors survive a swap by riding the resource registry as one shared table
  (`agent-sessions:table`), declared in the platform's resource interfaces: an
  incompatible successor hard-stops the table and falls back to the previous abort
  behavior. The successor's manager attaches itself to every monitor at construction;
  the monitor swaps its code pointer at the event boundary — immediately when idle,
  at the run's settle when busy — and the next event (a queued follow-up, or a parked
  run's continuation) is processed by the new generation. The loaded Session object is
  generation code and is reloaded from the Trace across the boundary.
- The engine gained a turn-boundary park request (`RunOptions.shouldPark`): consulted
  before each turn's LLM request, a park holds the pending turn input as carry-over —
  the same hold as the max-turns stop — and ends the generator without emitting
  anything. Trace replay's positional carry-over reconstruction produces the same input
  in the next generation. A run whose effective input is empty now ends without issuing
  a request.
- `SessionManager.quiesce()` replaces `shutdown()` in the swap path: running Tasks are
  asked to park instead of being aborted. Goal runs and compactions have no parkable
  boundary contract and keep the hard-abort semantics, still gating the successor's
  boot within the drain grace.
- The lame-duck window is the current turn, including its tool calls (a `run_subagent`
  call stretches it to the subagent's completion). The old generation's session
  environment is disposed at the pointer swap, so background commands started by the
  conversation do not survive it — unchanged from before.
