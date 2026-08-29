---
title: Goal Mode
description: Give the Agent an objective instead of a message — a stop hook keeps driving Tasks on one Session until the goal is complete, blocked, or out of token budget.
---

## What it is

A normal Task ends when the model stops calling tools and replies. Goal mode inverts the contract: you state an **objective**, and the system keeps driving Tasks on the same Session — each round re-injecting the objective and checking a control file — until the goal reaches a terminal state. The model never decides to stop by simply going quiet; it must *claim* completion (or a genuine impasse) through the protocol below, and everything else loops.

Under the hood goal mode is one [stop hook](/agent-loop#stop-hooks): when a Task ends, the goal hook reads the control file and answers `continue` — with the next round's `[goal]` message as the input — or `stop`. There is no loop of its own and no dedicated message type; the goal's end is the hook's `stop` event.

Start a goal from any of the three surfaces:

| Surface | How |
| --- | --- |
| Web App | The composer's `+` menu → **Goal mode** (or type `/goal`); the chip takes an optional token budget (`500k`, `2m`, empty = unlimited). Skills selected in the composer prefix the first round's message as a `[use_skills]` block, exactly like a normal send |
| CLI chat | `/goal[:<budget>] <objective>`, e.g. `/goal:500k make all tests pass` |
| CLI one-shot | `penguin run --goal [budget] -m "<objective>"`; exit code 0 only when the goal completes |
| Server API | `POST /api/sessions/:id/tasks` with `{ input, goal: { budget } }` (budget `-1` or omitted = unlimited) |

In the SDK, goal mode is an option of the one `run` call — `session.run(input, { goal: { budget } })` — not a separate API: the input's text becomes the objective, the file is written, the round-1 message is yielded and run, and the goal hook leads that call's stop hooks; every later round is the hook's `continue`. Hosts read the outcome from the hook's `stop` event with `goalOutcomeOf`, and recognize round boundaries with `isGoalRoundInput`.

## The state file: GOAL.yaml

The goal's state is a file at `<agent_dir>/scratchpad/<session_id>/GOAL.yaml` (sibling of the model's `PLAN.md` convention), created when the goal starts and rewritten by the goal hook after every round:

```yaml
objective: make all tests pass
status: active
budget: 500000
round: 3
tokens_used: 123456
```

| Field | Writer | Notes |
| --- | --- | --- |
| `objective` | system, at creation | the hook keeps its own copy and writes it back each round, so editing it changes nothing |
| `status` | model, or system | `complete` / `blocked` are the model's — its one mailbox back to the loop, and the only field it may touch; `active`, `wrapping_up` (the wrap-up round after the budget ran out), `budget_limited` and `aborted` are the system's |
| `budget` | system, at creation | the token budget for the whole goal; `-1` = none |
| `round` | system, every round | the round in progress; on a terminal status, the rounds run |
| `tokens_used` | system, every round | uncached input + output consumed so far, subagent sessions included |

The file is always the goal's current state — the Web server restores the chat page's banner straight from it. Reads are tolerant: a missing file or unparseable YAML stops the goal as `blocked` and leaves the file as it was, and an out-of-protocol status reads as `blocked` too — a broken control channel stops the loop instead of spinning it forever.

## The loop

Each round's user message is a `[goal]` protocol block followed by a plain body — round 1 carries your original message verbatim (skill-invocation blocks and all); later rounds re-inject the objective. The Web App collapses the block into a "Goal · round N" notice under a regular user bubble; the Trace shows it verbatim. The block embeds the `GOAL.yaml` the hook has just written — round, tokens used and budget included, so the model sees exactly the file it is asked to edit — and states the working rules: evidence-based verification before claiming completion, no shrinking the objective to an easier subset, and key progress recorded in `PLAN.md` so it survives context compaction. After the Task ends, the goal hook decides, first match wins:

- the file says `complete` → the goal is done; `blocked` → what the model needs from you is in its final reply. The injected rules require the **same blocking condition to persist for three consecutive rounds** before the model may claim `blocked`, so a transient obstacle doesn't end the goal;
- the Task was cut off (user stop, LLM failure, the per-Task `max_turns` cap) → `aborted`: the model never got to write the file, and re-firing would hit the same cutoff again;
- the wrap-up round just ran → `budget_limited`;
- 100 rounds → `aborted` (a runaway backstop for a goal with no or a huge budget whose model never writes the file);
- the budget is reached → one wrap-up round;
- otherwise → the next round.

Every answer is recorded as a `hook` event (`name: goal`) on the stream and in the Trace, with the file's state — `status`, `round`, `tokens_used`, `budget` — as its `output`. The terminal statuses are written to the file as well, so the file and the last event agree.

### Images in an objective

An objective may carry attached images — "make the page match this mockup" is a goal, and a screenshot states it better than a paragraph. They are always saved to the session scratchpad and referenced from the objective as `[attached image: <path>]` lines, **whatever the model's vision**: the objective is re-injected as the text of every round's block, so an image cannot ride along as an image. Sending it in round 1 alone would leave every later round pointing at something compaction has since removed, while the objective still reads correct. As a path it survives every round and every compaction, and the model spends tokens on it only when it actually looks (`read_image`, or `describe_image` without vision). An image cannot stand in for the text — a picture alone states no objective, so a text-less goal input is rejected.

The chat page shows the attachments in full under round 1's bubble and collapses them into a one-line chip on later rounds (click to expand): they are part of every round's input, but a twenty-round goal shouldn't repeat the same picture twenty times.

In the Web App the regular stop button aborts the entire goal; in the CLI, Ctrl-C does. A user's interruption outranks the hook: after a cutoff no `continue` is ever run, and the goal ends as `aborted` with the file saying so.

## Token budget

Accounting is the run's own: **uncached input + output** (`request.total − cache_read`), summed over every request of every round, *including subagent sessions* spawned by `run_subagent`. `tokens_used` starts at 0. The sum is a spend estimate, not a bill: cache reads cost money too, just a small fraction of the uncached-input price, so leaving them out keeps the number an honest approximation without per-model price tables.

The budget is checked between rounds. When it is exhausted the goal is not cut off mid-thought: one final wrap-up round is injected — summarize progress, list remaining work, leave a clear next step, and no claiming `complete` just because the money ran out — after which the hook ends the goal as `budget_limited` (a truthful `complete` written during the wrap-up still counts). Because the check runs between rounds only, a round already in flight is never cut short: actual spend can overshoot the budget by up to one round, plus the wrap-up round. With no budget set, the loop runs until `complete` or `blocked` — bounded by the model's honesty about the two terminal states, plus the hard backstop of 100 rounds.

## Server state and events

The Web server keeps no goal table: `GET /api/sessions/:id/goal` reads the Session's `GOAL.yaml` (null when it never ran a goal). A goal lives only inside its run, so a file still `active` (or in its wrap-up round) while the Session is not running was left behind by a crash or a kill and reads as `aborted`. Live progress arrives as `goal_started` / `goal_round` / `goal_finished` events on the session's SSE channel, derived from the stream — the round inputs and the goal hook's events. Deleting the Session removes the scratchpad, and `GOAL.yaml` with it.
