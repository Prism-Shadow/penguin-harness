# PRFC-0015 Agent State Component: hand off state during HMR, running tasks are not interrupted

[中文版](PRFC-0015-agent-state.zh.md)

> **Source**: `rfcs/PRFC-0015-agent-state.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are in [README.md](README.md), and per-version changes are recorded in the `## Changes` section at the end.

- Feature Name: `agent_state`
- Start Date: 2026-09-21
- PRFC PR: [Prism-Shadow/penguin-harness-design#209](https://github.com/Prism-Shadow/penguin-harness-design/pull/209)
- Implementation PR: [Prism-Shadow/penguin-harness#1059](https://github.com/Prism-Shadow/penguin-harness/pull/1059) (the state component), [#1060](https://github.com/Prism-Shadow/penguin-harness/pull/1060) (the handoff)

## Summary
[summary]: #summary

Before this proposal landed, a hot update (a hot push, or the App re-composition triggered by a plugin change) would abort every running Task. This proposal removes that interruption with three measures, without changing the Agent's run logic:

1. **An Agent state component (`AgentState`)**: all in-memory state of the Session runtime is gathered into one component; the component holds data only, no logic.
2. **The other components stay as they are**: not one line of the logic in existing parts such as `SessionManager` changes; they simply take their state from `AgentState` now.
3. **State is handed over on a hot update**: the new generation of the platform receives the previous generation's `AgentState`. If compatible, it takes over directly and running Tasks continue; if not, the **old logic** stops the running Tasks, and the **new logic** then runs them again from the filesystem state (the Trace).

## Motivation
[motivation]: #motivation

The dispose effect in `hmr/platform.ts` calls `manager.shutdown(5s)` on every swap: all pending approvals are denied, all running Tasks are aborted, and the Session environments are disposed. A hot push is not the only trigger — enabling, disabling, or reconfiguring a plugin goes through the same re-composition path, so a user changing one plugin setting breaks the work in every Agent's hands. Self-improvement presupposes that an Agent can update the harness while working; if every update breaks the work, that premise does not hold.

There were two earlier attempts: [#436](https://github.com/Prism-Shadow/penguin-harness/pull/436) (a monitor plus parking at turn boundaries) and [#439](https://github.com/Prism-Shadow/penguin-harness/pull/439) (turning the run loop inside out of the engine, an `HmrAgent` event loop). Both worked, and neither landed, for the same reason: **the change surface was too large**. #439 touched 483 lines of `context-engine.ts` and rewrote `session-manager.ts` wholesale (a 2108-line diff); most of the Agent's code, and even its logic, was touched. A change like that can neither coexist with other PRs developed in parallel nor be reviewed.

The judgment at the time was that "state is scattered across the components, so the logic must be reorganized". A fresh inventory shows that judgment does not hold — the in-memory state is in fact concentrated in six fields of `SessionManager`:

| Field | Contents |
| --- | --- |
| `entries` | One `RuntimeEntry` per loaded Session: core's Session object, `status`, `approvals`, `abort`, `running` (the Promise of the in-flight drive), `followUps`, `pendingInputs` / `pendingBootstrap`, `pendingSteering` / `returnedSteering`, `backgroundTasks`, `generation`, `lastActivityMs` |
| `locks` | The mutual-exclusion chain per Session |
| `deletingAgents` / `deletingSessions` | Deletion-window markers |
| `agentGenerations` | Agent configuration generations |
| `liveTail` | In-flight streaming fragments |

The rest of the state was never in the platform generation's hands to begin with: the Trace and the `sessions` rows are on disk, and the db, the channel hub, and the auth state are held by the HMR layer and re-claimed by each generation of the platform. So the table above is all there is to hand over, and handing it over does not require touching any logic.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

Think of one generation of the platform as the "logic" and of `AgentState` as the "data". A swap replaces the logic; the data is handed to the next generation as it is:

```
generation N    SessionManager ──┐
                                 ├──> AgentState (one and the same object, registered in the HMR registry)
generation N+1  SessionManager ──┘
```

At swap time every Session falls into one of three situations:

- **Idle**: nothing happens. The next Task is started by the new generation.
- **Running, state compatible**: the new generation takes over the `AgentState`. The Task is not interrupted and its status reads `running` throughout; after the swap, approvals, steering, interrupts, and queued follow-ups are all handled by the new generation's logic, operating on the same state.
- **Running, state incompatible**: the old generation stops the Task by its own logic (the same behavior as today: an abort event is written to the Trace); once the new generation is up, it restores these Sessions from the Trace and keeps them running.

One point needs to be made clear: **a Task that is in flight keeps running on the old code until it finishes.** An executing `drive()` is the old generation's function, and JS cannot replace a function while it executes; the core Session object it holds also belongs to the old generation. The compatible path means "do not interrupt it" — the new code takes effect from that Session's next Task onward. Making the new code take effect already at a turn boundary would require turning the run loop inside out, which is exactly what #439 cost; this proposal does not do it (see Future possibilities).

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### The `AgentState` component

A new node `AgentStateStore` is added under the module tree's `SessionRuntimeModule`, providing the interface `AgentState`: it holds the six fields from the Motivation table, plus a `current` pointer (see below). It has no method logic and is empty at construction time.

`SessionManager` receives it through its deps and points its own same-named fields at the component's fields:

```ts
constructor(private readonly deps: SessionManagerDeps) {
  this.entries = deps.state.entries;
  this.locks = deps.state.locks;
  // …
}
```

The code inside `SessionManager` that reads and writes `this.entries` and the rest stays as it is. This step is a pure refactor — zero behavior change; the existing tests pass unmodified.

### The handoff

It reuses the mechanism the terminal (pty) already uses; the HMR layer needs no changes at all:

- Each generation of the App, at **COMMIT** (once the App is fully built), registers `{ state, shape, stopped? }` as the registry's `agent:state`; the disposer given at registration is **that generation's own stop action**, namely today's `manager.shutdown()`.
- The platform's dispose effect **no longer calls** `manager.shutdown()`; the old generation only does `detach()` (stopping the idle-sweep timer). The process-exit path is unchanged: `api.shutdown()` and the registry's `disposeAll()` still drain everything.
- Once the new generation has judged compatibility, it hands the previous generation's `state` object to the module tree as the ready-made instance of the `AgentStateStore` node (`platformDef(…, inherited)`), and the new `SessionManager` is built directly on top of it.
- Whether anything stops happens at COMMIT: if the new generation fails to boot, the kernel restarts the previous generation's bundle, the registry still holds the previous generation's registration, and no Task was ever stopped — the rollback is lossless.

### The compatibility judgment

`AgentState` is an interface that enters the interface table **by structure** and contains no `Opaque`: `entries` is projected as `{ map: [string, the member-by-member shape of RuntimeEntry] }`, where `session` is the interface `RuntimeSession`, `approvals` is the interface `Approvals`, `liveTail` is the interface `LiveTail`, and the two deletion windows are `{ set: string }` (for the projection of `Map` / `Set`, see PRFC-0001's "Boundaries of the projection"). The old generation's Session object will be called by the new generation's logic, so its method surface is part of the contract as well.

The judgment uses the **closed shape** (the core kernel's `closedShape(table, key)`): the declaration of `AgentState`, together with every interface and named data type it reaches through the interface table, is printed into one string with the keys sorted. Each generation registers its own string (the `shape` above) along with the state; the new generation compares it with its own — if **equal**, it takes over; otherwise it goes down the incompatible path.

Equality rather than assignability (`satisfies`), for two reasons: the state is read **and** written by both generations, and one-directional assignability is not enough to guarantee safety; and an equality comparison does not need the other side's interface table — one string suffices. There is no hand-written member list — change the shape of `RuntimeEntry` or `RuntimeSession`, the generator re-projects, and the string changes on its own.

`DECLARED_RESOURCES` gains a new group `agent` at the same time, declaring the three members of the envelope `{ state, shape, stopped }`. It does not describe the state's shape; its job is to make **an old platform that does not declare this group** `disposeGroup` it by the existing rules on rollback, stopping the runs (see "A layered decision").

### Incompatible: the old logic stops, the new logic restarts

- `SessionsModule`'s `park()` returns `{ running: string[] }`: the sessionIds that were running a Task at park time. It is JSON and travels through the module tree's existing parked context (with versions and migrations).
- When the shapes are not equal, the new generation records the `agent` group into `doomedGroups`, treating it like any group whose version does not match; the `disposeGroup` at the COMMIT stage fires the disposer the old generation registered — **the old logic's** `shutdown()`: deny approvals, abort, dispose the environments. The abort is written to the Trace as usual. The disposer writes `shutdown()`'s Promise back into the envelope's `stopped`.
- After `stopped` resolves (the old drive ends, or the 5-second cap), the new generation calls `startTask` on each Session in `running`, one by one, with a `sender: "server"` `[harness_updated]` resume message as the input. Core's existing carry-over brings the interrupted turn (`[turn_aborted]`) back into the context, and the Agent picks up from the break point.
- Compaction keeps today's semantics on the incompatible path (stop, no restart). A Goal runs on an entry as `running` just like an ordinary Task and cannot be told apart, so the first version resumes it as an ordinary Task; whether the goal's stop hook then drives the subsequent turns is not yet verified. Queued follow-ups live only in memory and are discarded with the old state, same as today.

### The `current` pointer

The in-flight `drive()` belongs to the old generation, and two things must happen when it ends: starting the next queued follow-up, or delivering a background completion notice. Both must be done by the **current** generation, or the Session would be loaded by the old loader and would read the old, `closed` manager. So `AgentState` holds `current`: a `RunStarter` with just those two methods (not the whole manager — otherwise any change to the manager's public surface would change the closed shape); each generation points it at itself at construction, and the two calls at the end of `drive()`, along with the `onBackgroundNotice` listener registered on the Session object, are forwarded through `state.current`.

This is the only touch this proposal makes on existing logic: three call sites change from `this.` to `this.state.current?.`.

### Dependencies after the old tree's dispose

The old generation's in-flight `drive()` and Session objects still use the old tree's nodes after the old module tree is disposed: `recorder`, `errors`, `titles`, `sessions` (the repository), `channels`, and the Session environment's four getters (`proxyEnv`, `controlEnv`, `pathPrepend`, `confineSpawn`). The db and the channel hub are held by the HMR layer and are unaffected by the dispose.

The rule: **these nodes must remain callable after the dispose.** What the landing verified (#1060): none of the nodes listed above has a dispose effect, and neither does `sandbox.confiner()`, so no detour was needed. When adding a node that does have a dispose effect, if an in-flight run can reach it, the current generation's corresponding node must be taken through `state.current`.

### A layered decision

It is all platform code. The HMR layer and the runtime are unchanged: the registry, `disposeGroup`, the resource interface gate, and the parked context already exist, and the old layers can carry it directly. When the first platform that declares `agent` is pushed on top of an old platform, the previous generation declared no such group and registered no `AgentState`, and its dispose effect `shutdown()`s as before — the same behavior as today, no compatibility code needed. On a rollback in the other direction, onto an old platform that does not declare the group, the old platform's resource interface gate judges `agent` as "a group this build no longer declares" and `disposeGroup`s it; the Tasks are stopped by the registered disposer — likewise the same behavior as today.

### The merged implementations

1. **[#1059](https://github.com/Prism-Shadow/penguin-harness/pull/1059)**: the `AgentState` node and `SessionManager`'s fields pointing at it; the interface table gains `{ map }` / `{ set }`, so that `AgentState` contains no `Opaque`. No behavior change.
2. **[#1060](https://github.com/Prism-Shadow/penguin-harness/pull/1060)**: `closedShape`, the handoff, the `current` pointer, the park and restart on the incompatible path, and an integration test against a real kernel `upgrade()` (via App re-composition): a running Task crosses the swap without interruption, and the successor starts the follow-up the old run hands over as it finishes; when the shapes differ, the old run is stopped and a new run starts with `[harness_updated]`.

## Drawbacks
[drawbacks]: #drawbacks

- During one long Task, the old generation's code and objects stay alive; push N times in a row and, at worst, N generations coexist until their respective Tasks end.
- The new generation's logic operates on the old generation's objects, with the contract policed by the interface table's structural comparison; the comparison goes only as far as signatures — a change that alters semantics while leaving the signature intact is invisible to it.
  - The 2026-09-22 instance: a machine ssh session object delivered across a push (the `machineSession` group) carried the previous generation's `setForwards` implementation — the signature was unchanged but the behavior had changed (the old implementation only logged, never asked ssh); neither the resource interface gate nor the closed shape could see it, and the port forwarding was stuck at `pending` forever. The lesson: **any live object delivered to the next generation must bump its group-name version when its behavior changes** (e.g. `machineSession.v2`); the closed shape can only catch changes of shape. The same goes for `AgentState` — change the semantics of a method on `RuntimeSession` without changing its signature, and the `agent` group's version must change.
- Machine sessions also register a closed shape (`machineSession.v2:shape`); when the shape is incompatible, the old session is closed at the COMMIT stage and the new generation establishes the connection. Behavior changes beyond member signatures still require raising the group-name version.
- Between a swap and the end of a Task, bug fixes do not take effect for that Task.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Park at turn boundaries + reload from the Trace (#436)**, **turn the run loop inside out + an event loop (#439)**: the new code can take effect on the next turn, but both require changing the control flow of the engine and the manager. The two attempts already showed that this path's change surface is unacceptable.
- **Put each run in a subprocess**: a swap naturally does not interrupt, but approvals, streams, steering, subagents, and usage accounting all have to cross the process boundary — a change surface larger than #439's.
- **Do nothing**: plugin re-composition has already made the interruption an everyday operation; not doing this is not an option.

What this design rests on: the state is already concentrated, and the handover machinery (the registry, the resource interface gate, the parked context) already exists and has been verified by the terminal. What is new is one data component and one pointer.

## Prior art
[prior-art]: #prior-art

- This repository's terminal module: pty objects are registered in the registry, the parked document carries only the id, and the successor generation claims them; on incompatibility, `disposeGroup`. This proposal is the same pattern applied to the Session runtime.
- Erlang/OTP's code change: process state is kept across versions, with `code_change` doing the judgment and the migration; old-version code stays alive while still referenced — the same principle as "an in-flight Task finishes on the old code" here.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- The wording of the resume message (currently `[harness_updated] …`), and whether it is shown to the user in the conversation.
- In-flight Tasks triggered by a messaging bot: the old message bridge stops with the old App, and whether the new message bridge can catch that run's output is not yet verified (today such a run is simply aborted).
- After a compatible takeover, whether idle entries should be dropped immediately and re-loaded by the new generation on the next access (so that new core code takes effect sooner). The first version does not drop them: no logic changes, and idle entries are reclaimed after 30 minutes anyway.
- Whether queued follow-ups should be parked as well on the incompatible path (the input may contain large images).

## Future possibilities
[future-possibilities]: #future-possibilities

- Once the state component stands, a turn-boundary handover can follow as a separate proposal: the run's continuation state would then also go into `AgentState`, and the new code would take effect on the next turn.
- The same pattern can be applied to the modules that today are "stopped and rebuilt" at swap time, such as the scheduler and the message bridges.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
