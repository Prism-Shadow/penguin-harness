# The agent loop inverted: hot swaps no longer interrupt running Tasks

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#439](https://github.com/Prism-Shadow/penguin-harness/pull/439)

[中文版本](./2026-08-24-agent-event-loop.zh.md)

A platform hot push used to hard-stop every running agent Task: the LLM stream aborted,
tool subprocesses were killed, pending approvals converged to deny. The run loop is now
inverted out of the engine into a stable per-session event loop, and a push swaps code
between events: at a running Task's next turn boundary the new generation simply takes
the next turn of that same run — the status reads `running` throughout, no turn is
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
  and swapped between calls. Follow-up tasks and background-notice delivery are
  ordinary queue events. `SessionManager` holds no per-session state; it is the facade
  plus the generation's `AgentImpl` (open a run, advance it one turn, close it).
- The agents ride the resource registry as one shared `hmr-agents:table` entry, declared
  in the platform's resource interfaces: an incompatible successor hard-stops the table
  and falls back to the previous abort behavior. A running Task is ADOPTED, not
  restarted — the successor takes the next turn of the very same run, so the swap needs
  no suspend, no reload and no continuation event. Only the Session object stays the
  generation that created it: it is marked stale at the swap, so the NEXT run reloads
  through the successor's loader, the same mechanism a vault update uses.
- The per-message pipeline (subagent registration and titles, the bootstrap holds, live
  tail, publish, usage recording) moved to `runtime/run-stream.ts` and goal mode to
  `runtime/goal-run.ts`, so the manager is a facade over the loop rather than a god
  object: it dropped from 1963 to 1350 lines.
- Goals and compactions have no turn-boundary contract yet and keep the hard-abort
  semantics, still gating the successor's boot within the drain grace. What stays on the
  old code across a swap is exactly the adopted run's own engine, until that run ends;
  its background commands and MCP connections go with the Session when it is reloaded,
  the same as before.
