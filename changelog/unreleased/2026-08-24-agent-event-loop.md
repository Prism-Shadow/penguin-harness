# The agent loop inverted: hot swaps no longer interrupt running Tasks

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#439](https://github.com/Prism-Shadow/penguin-harness/pull/439)

[中文版本](./2026-08-24-agent-event-loop.zh.md)

A platform hot push used to hard-stop every running agent Task: the LLM stream aborted,
tool subprocesses were killed, pending approvals converged to deny. The run loop is now
inverted out of the engine into a stable per-session event loop, and a push swaps code
between events: a running Task is suspended at its next turn boundary and finished by
the new generation from the Trace — the status reads `running` throughout, no turn is
aborted, no side effect is redone, and approvals and interrupts keep working.

## Details

- The engine's internal `for(;;)` over turns is gone: `beginRun` reifies the between-turn
  continuation as data, `stepTurn` takes exactly one turn (the LLM request with its
  reconnect ladder, tools, the compaction checkpoint, next-input assembly) and answers
  `continue`/`done`, and `endRun` closes the run on every exit path. `Session.run`
  remains as the facade driving the steps, and the Session exposes the same stepped
  surface (`beginRun`/`stepRun`/`endRun`) wrapping image folding, bootstrap and
  title-material capture. A run whose effective input is empty ends without issuing a
  request.
- Each session's cross-generation state — the event queue, run status, pending
  approvals, the interrupt controller, display mirrors — lives in an `HmrAgent`
  (`runtime/hmr-agent.ts`): a queue, a pump that asks the CURRENT generation to advance
  the head event one turn per call, and a `pending` pointer attached by the successor
  and swapped between calls. Follow-up tasks, a suspended run's remainder and
  background-notice delivery are all just queue events. `SessionManager` holds no
  per-session state; it is the facade plus the generation's `AgentImpl`
  (open/step/suspend/finish).
- The agents ride the resource registry as one shared `hmr-agents:table` entry, declared
  in the platform's resource interfaces: an incompatible successor hard-stops the table
  and falls back to the previous abort behavior. A run never spans generations — at the
  swap boundary the old generation closes it gracefully (the Trace carries the
  continuation, reconstructed positionally on reload) and the successor's loader
  reloads the session.
- An interrupt always wins over the swap: a run whose abort has fired is never
  suspended-and-continued, and an interrupt landing between a suspend and its
  continuation cancels the relaunch.
- Goals and compactions have no turn-boundary contract yet and keep the hard-abort
  semantics, still gating the successor's boot within the drain grace. The suspended
  window is the current turn including its tool calls (a `run_subagent` call stretches
  it); the old generation's session environment is disposed at the swap, so background
  commands started by the conversation do not survive it — unchanged from before.
