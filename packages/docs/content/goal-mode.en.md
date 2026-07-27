---
title: Goal Mode
description: Give the Agent an objective instead of a message — the system loops Tasks on one Session until the goal is complete, blocked, or out of token budget.
---

## What it is

A normal Task ends when the model stops calling tools and replies. Goal mode inverts the contract: you state an **objective**, and the system keeps driving Tasks on the same Session — each round re-injecting the objective and checking a control file — until the goal reaches a terminal state. The model never decides to stop by simply going quiet; it must *claim* completion (or a genuine impasse) through the protocol below, and everything else loops.

Start a goal from any of the three surfaces:

| Surface | How |
| --- | --- |
| Web App | The composer's `+` menu → **Goal mode** (or type `/goal`); the chip takes an optional token budget (`500k`, `2m`, empty = unlimited). Skills selected in the composer prefix the first round's message as a `[use_skills]` block, exactly like a normal send |
| CLI chat | `/goal[:<budget>] <objective>`, e.g. `/goal:500k make all tests pass` |
| CLI one-shot | `penguin run --goal [budget] -m "<objective>"`; exit code 0 only when the goal completes |
| Server API | `POST /api/sessions/:id/tasks` with `{ input, goal: { budget } }` (budget `-1` or omitted = unlimited) |

In the SDK, goal mode is an option of the one `run` call — `session.run(input, { goal: { budget } })` — not a separate API: the input's text becomes the objective, rounds loop inside the call, and the stream's final message is a `goal_finished` event carrying the outcome.

## The control file: GOAL.yaml

The loop's state channel is a file at `<agent_dir>/scratchpad/<session_id>/GOAL.yaml` (sibling of the model's `PLAN.md` convention), created by the system when the goal starts:

```yaml
objective: make all tests pass
status: active
```

The system writes this file **exactly once**, at creation; afterwards it only reads `status`:

| Field | Writer | Notes |
| --- | --- | --- |
| `objective` | system, at creation | the canonical value lives in the loop's memory and is re-stated in every round's block, so a tampered file changes nothing |
| `status` | model | only to `complete` or `blocked` — the model's mailbox back to the loop, read after every round |

Budget numbers ride each round's `[goal]` block, not the file; system-side endings (`budget_limited`, `aborted`) exist only as the `goal_finished` outcome and in server state — the file always keeps the model's own last write, which is exactly the resume point an interrupted goal wants. Reads are tolerant: a missing file, unparseable YAML, or an out-of-protocol status all normalize to `blocked` — a broken control channel stops the loop instead of spinning it forever.

## The loop

Each round's user message is a `[goal]` protocol block followed by a plain body — round 1 carries your original message verbatim (skill-invocation blocks and all); later rounds re-inject the objective. The Web App collapses the block into a "Goal · round N" notice under a regular user bubble; the Trace shows it verbatim. The block embeds the `GOAL.yaml` content (the model sees exactly the file it is asked to edit, composed from the same values it was created with), carries the current budget numbers on its own line, and states the working rules — evidence-based verification before claiming completion, no shrinking the objective to an easier subset, and key progress recorded in `PLAN.md` so it survives context compaction. After the Task ends, the system reads `status`:

- `complete` → the goal is done; the loop stops.
- `blocked` → the loop stops; what the model needs from you is in its final reply. The injected rules require the **same blocking condition to persist for three consecutive rounds** before the model may claim `blocked`, so a transient obstacle doesn't end the goal.
- `active` → budget permitting, the next round fires.

A round that ends in an abort (user stop, LLM failure) ends the whole goal without re-firing — on-disk state stays `active`, so the workspace and goal file remain a clean resume point. In the Web App the regular stop button aborts the entire loop; in the CLI, Ctrl-C does. The same applies to a round the engine cut off at the per-Task turn cap (`max_turns`): the model never got to write the goal file, so the loop ends as `aborted` instead of re-firing the same cutoff forever.

## Token budget

Accounting is incremental — **uncached input + output** (`request.total − cache_read`), summed over every request of every round, *including subagent sessions* spawned by `run_subagent`. `used` starts at 0. The sum is a spend estimate, not a bill: cache reads cost money too, just a small fraction of the uncached-input price, so leaving them out keeps the number an honest approximation without per-model price tables.

The budget is checked between rounds. When it is exhausted the goal is not cut off mid-thought: one final wrap-up round is injected — summarize progress, list remaining work, leave a clear next step, and no claiming `complete` just because the money ran out — after which the system ends the goal as `budget_limited` (the `goal_finished` outcome; nothing is written to the file). Because the check runs between rounds only, a round already in flight is never cut short: actual spend can overshoot the budget by up to one round, plus the wrap-up round. With no budget set, the loop runs until `complete` or `blocked` — bounded by the model's honesty about the two terminal states, plus a hard backstop of 100 rounds so a model that simply never writes the goal file cannot loop forever.

## Server state and events

The Web server records each goal run in a `goal_state` row (objective, status, budget, used, rounds) — the chat page's goal banner restores from the latest row on load, and live progress arrives as `goal_started` / `goal_round` / `goal_finished` events on the session's SSE channel. System-side terminal statuses (`aborted`, `budget_limited`) exist in this row and on the stream only; the on-disk file keeps the model's last write for resuming. Deleting the Session removes its goal rows along with the scratchpad (and `GOAL.yaml` with it).
