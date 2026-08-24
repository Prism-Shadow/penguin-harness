# A hot swap no longer interrupts running agent Tasks

- **Date:** 2026-08-24
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#436](https://github.com/Prism-Shadow/penguin-harness/pull/436)

[中文版本](./2026-08-24-agent-run-handoff.zh.md)

A platform hot push used to hard-stop every running agent Task: the LLM stream aborted,
tool subprocesses were killed, pending approvals converged to deny. Now a running Task
survives the swap: the old generation's drive keeps running to its next turn boundary and
parks there silently, and the successor App resumes the run from the Trace — the
transcript continues where it left off, with no aborted turn and no redone side effects.

## Details

- The engine gained a turn-boundary park request (`RunOptions.shouldPark`): consulted
  before each turn's LLM request, a park holds the pending turn input as carry-over —
  the same hold as the max-turns stop — and ends the generator without emitting
  anything. In-process resume rides the engine's carry-over; across a generation change
  the Trace replay's positional carry-over reconstruction produces the same input. A run
  whose effective input is empty now ends without issuing a request.
- `SessionManager.quiesce()` replaces `shutdown()` in the swap path: running Tasks are
  asked to park instead of being aborted, and each is handed to the successor as a
  `RunHandoff` — status reads busy, approval decisions and interrupts forward to the old
  generation's registries, and no second writer can be loaded onto the Trace until the
  old drive settles. Goal runs and compactions have no parkable boundary contract and
  keep the hard-abort semantics, still gating the successor's boot within the drain
  grace.
- The handles ride the resource registry as one `agent-runs:handoff` entry, declared in
  the platform's resource interfaces: an incompatible successor hard-stops the group and
  falls back to the previous abort behavior, and the process-exit sweep stops a lame
  duck that never found an adopter.
- The lame-duck window is the current turn, including its tool calls (a `run_subagent`
  call stretches it to the subagent's completion). The old generation's session
  environment is still disposed once its drive settles, so background commands started
  by the conversation do not survive the swap — unchanged from before.
