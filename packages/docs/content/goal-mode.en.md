---
title: Goal Mode
description: Give the Agent an objective instead of a message — the system loops Tasks on one Session until the goal is complete, blocked, or out of token budget.
---

## What it is

A normal Task ends when the model stops calling tools and replies. Goal mode inverts the contract: you state an **objective**, and the system keeps driving Tasks on the same Session — each round re-injecting the objective and checking a control file — until the goal reaches a terminal state. The model never decides to stop by simply going quiet; it must *claim* completion (or a genuine impasse) through the protocol below, and everything else loops.

Start a goal from any of the three surfaces:

| Surface | How |
| --- | --- |
| Web App | The composer's `+` menu → **Goal mode** (or type `/goal`); the chip takes an optional token budget (`500k`, `2m`, empty = unlimited) |
| CLI chat | `/goal[:<budget>] <objective>`, e.g. `/goal:500k make all tests pass` |
| CLI one-shot | `penguin run --goal [budget] -m "<objective>"`; exit code 0 only when the goal completes |
| Server API | `POST /api/sessions/:id/tasks` with `{ input, goal: { budget } }` (budget `-1` or omitted = unlimited) |

## The control file: GOAL.yaml

The loop's state channel is a file at `<agent_dir>/scratchpad/<session_id>/GOAL.yaml` (sibling of the model's `PLAN.md` convention), created by the system when the goal starts:

```yaml
objective: make all tests pass
status: active
tokens:
  budget: 500000
  used: 120345
  remaining: 379655
```

Ownership is strict, and the file is deliberately **not** trusted for enforcement:

| Field | Writer | Notes |
| --- | --- | --- |
| `objective` | system, once | never changed afterwards |
| `status` | model | only to `complete` or `blocked`; the system writes the initial `active` and the terminal `budget_limited` |
| `tokens` | system, every round | display only — budget enforcement always uses the runner's internal counters, so a clobbered file cannot unlock spending |

Reads are tolerant: a missing file, unparseable YAML, or an out-of-protocol status all normalize to `blocked` — a broken control channel stops the loop instead of spinning it forever.

## The loop

Each round injects a `<goal_task>` user message (collapsed to a one-line "Goal · round N" notice in the Web App; verbatim in the Trace) carrying the objective, current budget numbers, and the working rules — evidence-based verification before claiming completion, no shrinking the objective to an easier subset, and key progress recorded in `PLAN.md` so it survives context compaction. After the Task ends, the system reads `status`:

- `complete` → the goal is done; the loop stops.
- `blocked` → the loop stops; what the model needs from you is in its final reply. The injected rules require the **same blocking condition to persist for three consecutive rounds** before the model may claim `blocked`, so a transient obstacle doesn't end the goal.
- `active` → budget permitting, the next round fires.

A round that ends in an abort (user stop, LLM failure) ends the whole goal without re-firing — on-disk state stays `active`, so the workspace and goal file remain a clean resume point. In the Web App the regular stop button aborts the entire loop; in the CLI, Ctrl-C does.

## Token budget

Accounting is incremental — **uncached input + output** (`request.total − cache_read`), summed over every request of every round, *including subagent sessions* spawned by `run_subagent`. `used` starts at 0; cache hits are free.

The budget is checked between rounds. When it is exhausted the goal is not cut off mid-thought: one final wrap-up round is injected — summarize progress, list remaining work, leave a clear next step, and no claiming `complete` just because the money ran out — after which the system writes `budget_limited` and stops. With no budget set, the loop runs until `complete` or `blocked`; there is no round cap, so an unbudgeted goal is bounded only by the model's honesty about the two terminal states.

## Server state and events

The Web server records each goal run in a `goal_state` row (objective, status, budget, used, rounds) — the chat page's goal banner restores from the latest row on load, and live progress arrives as `goal_started` / `goal_round` / `goal_finished` events on the session's SSE channel. The row's terminal `aborted` status exists server-side only; the on-disk file keeps `active` for resuming. Deleting the Session removes its goal rows along with the scratchpad (and `GOAL.yaml` with it).
