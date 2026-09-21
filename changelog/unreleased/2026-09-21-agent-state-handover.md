# A hot update no longer interrupts running Tasks

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `server`, `core`
- **PR:** [#818](https://github.com/Prism-Shadow/penguin-harness/pull/818)

[中文版](2026-09-21-agent-state-handover.zh.md)

A hot push, and the App re-assembly that every plugin change triggers, used to deny every pending
approval and abort every running Task. The Agent state now changes hands instead: the next App
boots over the previous App's state, and the Tasks go on.

## Details

- The leaving App registers its `AgentState` node in the HMR registry as `agentState:state`,
  together with the closed shape of the `AgentState` interface as its build declares it — the
  interface and everything it reaches through the interface table, printed as one canonical
  string (`closedShape`, new in core's kernel).
- A successor that prints the same string boots over that very object. A running Task keeps
  reading `running`; approvals, steering, interrupts and queued follow-ups that arrive after the
  swap are handled by the new App on the same state. A Task already in flight finishes on the
  code that launched it; what it starts when it ends — the next queued follow-up, a background
  notice — is started by the App that is current by then.
- A successor that prints a different string disposes the group. That runs the predecessor's own
  stop (approvals denied, runs aborted, environments disposed — what every swap used to do), and
  the successor then starts each Session that had a Task in flight again from its Trace, with a
  `[harness_updated]` note; core's carry-over brings the interrupted turn back.
- Nothing is stopped until the successor is fully built, so a boot that fails re-adopts a state
  nobody touched.
- Process exit is unchanged: the graceful drain still runs.
- A plugin change re-assembles the same build, so it always takes the state over.
- No HMR-layer or runtime change: the registry, the resource-interface gate and the parked
  context already existed. Pushed onto an App that predates this, the first swap behaves as
  before; rolled back to such an App, the runs are stopped as before.
