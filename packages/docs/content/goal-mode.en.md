---
title: Goal Mode
description: Give the Agent an objective instead of a message — the goal plugin's stop hook keeps driving Tasks on one Session until the goal is complete, blocked, or out of token budget.
---

## What it is

A normal Task ends when the model stops calling tools and replies. Goal mode inverts the contract: you state an **objective**, and the system keeps driving Tasks on the same Session — each round re-injecting the objective and checking a goal file — until the goal reaches a terminal state. The model never decides to stop by simply going quiet; it must *claim* completion (or a genuine impasse) through the protocol below, and everything else loops.

Goal mode is the **`goal` plugin**, a [hook package](/skills#hook-packages) preinstalled on `default_agent` and installable on any Agent from the plugin library. Its `start.mjs` — the package's [`user_prompt` hook](/agent-loop#user-prompt-hooks) — writes the goal file and answers the submitted prompt with round 1's protocol message as expansion `context`; its `stop.mjs` — a [stop hook](/agent-loop#stop-hooks) — reads the Session's Trace after every Task and answers `continue` with the next round's message, or `stop`. Nothing in the core SDK knows what a goal is; the loop that consults hooks is generic. An Agent without the plugin cannot start a goal: the Web App and the API say so (`409 goal_plugin_not_installed`) instead of running a Task that would simply end.

Start a goal from any of the three surfaces:

| Surface | How |
| --- | --- |
| Web App | The composer's `+` menu → **Goal mode** (or type `/goal`); the chip takes an optional token budget (`500k`, `2m`, empty = unlimited). Skills selected in the composer prefix the first round's message as a `[use_skills]` block, exactly like a normal send |
| CLI chat | `/goal[:<budget>] <objective>`, e.g. `/goal:500k make all tests pass` |
| CLI one-shot | `penguin run --goal [budget] -m "<objective>"`; exit code 0 only when the goal completes |
| Server API | `POST /api/sessions/:id/tasks` with `{ input, goal: { budget } }` (budget `-1` or omitted = unlimited) |

Under the hood the server asks the Session to run the goal package's `user_prompt` hook — the installed `agent_state/hooks/goal/start.mjs`, fed `{ hook: "user_prompt", session_id, scratchpad_dir, prompt, budget }` on stdin — and starts the goal run with your message exactly as typed followed by the `{ context }` it prints, stamped `sender: "harness"`; the stop hook takes it from there. In the SDK, a goal is therefore a plain `session.run` on an Agent with the plugin installed, started by writing the goal file the same way (`Session.runUserPromptHook("goal", …)`, or the script directly).

## The goal file: GOAL.json

The goal's state is a file at `<agent_dir>/scratchpad/<session_id>/GOAL.json` (sibling of the model's `PLAN.md` convention), created when the goal starts and rewritten by the stop hook after every round:

```json
{
  "objective": "make all tests pass",
  "status": "active",
  "budget": 500000,
  "round": 3,
  "tokens_used": 123456
}
```

| Field | Writer | Notes |
| --- | --- | --- |
| `objective` | the start script | the text every later round re-injects |
| `status` | model, or the hook | `complete` / `blocked` are the model's — its one mailbox back to the loop, and the only field it may touch; `active`, `wrapping_up` (the wrap-up round after the budget ran out), `budget_limited` and `aborted` are the hook's |
| `budget` | the start script | the token budget for the whole goal; `-1` = none |
| `round` | the hook, every round | the round in progress; on a terminal status, the rounds run |
| `tokens_used` | the hook, every round | uncached input + output the main session consumed so far, read off the Trace |
| `ended` | the hook, at the end | `true` once the hook has acted on a terminal status — what tells a goal this run just ended from one an earlier run ended (the hook stays silent for those) |

The file is always the goal's current state — the Web server restores the chat page's banner straight from it. Reads are tolerant: a file that no longer parses stops the goal as `blocked` and is moved aside as `GOAL.json.broken`, and a `status` outside the protocol reads as `blocked` — a broken control channel stops the loop instead of spinning it forever.

## The loop

Each round's protocol message is plain user text stamped `sender: "harness"` — no marker block; the stamp alone says the harness sent it, and the Web App renders it as a compact collapsed card ("Injected by the harness", the background notices' form) that expands to the full text. Round 1 sends your own message verbatim first (text and images, skill-invocation blocks and all) with the protocol message right behind it pointing back at yours as the objective; later rounds restate the objective from the goal file. The protocol message embeds the `GOAL.json` the hook has just written — round, tokens used and budget included, so the model sees exactly the file it is asked to edit — and states the working rules: evidence-based verification before claiming completion, no shrinking the objective to an easier subset, and key progress recorded in `PLAN.md` so it survives context compaction. After the Task ends, the stop hook reads the Trace and the file and decides, first match wins:

- the file says `complete` → the goal is done; `blocked` → what the model needs from you is in its final reply. The injected rules require the **same blocking condition to persist for three consecutive rounds** before the model may claim `blocked`, so a transient obstacle doesn't end the goal;
- the Task was cut off — an `abort` event (user stop), a last request that failed for good, or the per-Task `max_turns` notice — → `aborted`: the model never got to write the file, and re-firing would hit the same cutoff again;
- the wrap-up round just ran → `budget_limited`;
- 100 rounds → `aborted` (a runaway backstop for a goal with no or a huge budget whose model never writes the file);
- the budget is reached → one wrap-up round;
- otherwise → the next round.

Every answer is recorded as a `hook` event (`name: goal`) on the stream and in the Trace, with the file's state — `status`, `round`, `tokens_used`, `budget` — as its `output`. The terminal statuses are written to the file as well, so the file and the last event agree.

### Images in an objective

An objective may carry attached images: they ride round 1 as ordinary input, and the model sees them then. Later rounds re-inject the objective text only. An image cannot stand in for the text — a picture alone states no objective, so a text-less goal input is rejected; file attachments are refused, since nothing carries them across rounds.

In the Web App the regular stop button aborts the entire goal; in the CLI, Ctrl-C does. A user's interruption outranks the hook: after a cutoff no `continue` is ever run, and the goal ends as `aborted` with the file saying so.

## Token budget

The hook counts the round's usage off the Trace: **uncached input + output** (`request.total − cache_read`) of every `token_usage` record since the round's harness-injected input, added to `tokens_used`. Subagent sessions have their own Traces and are not counted. The sum is a spend estimate, not a bill: cache reads cost money too, just a small fraction of the uncached-input price, so leaving them out keeps the number an honest approximation without per-model price tables.

The budget is checked between rounds. When it is exhausted the goal is not cut off mid-thought: one final wrap-up round is injected — summarize progress, list remaining work, leave a clear next step, and no claiming `complete` just because the money ran out — after which the hook ends the goal as `budget_limited` (a truthful `complete` written during the wrap-up still counts). Because the check runs between rounds only, a round already in flight is never cut short: actual spend can overshoot the budget by up to one round, plus the wrap-up round. With no budget set, the loop runs until `complete` or `blocked` — bounded by the model's honesty about the two terminal states, plus the hard backstop of 100 rounds.

## Server state and events

The Web server keeps no goal table: `GET /api/sessions/:id/goal` reads the Session's `GOAL.json` (null when it never ran a goal). A goal lives only inside its run, so a file the hook has not ended while the Session is not running was left behind by a crash or a kill and reads as `aborted`. Live progress arrives as `goal_started` / `goal_round` / `goal_finished` events on the session's SSE channel, derived from the stream — the round inputs and the goal hook's events. Deleting the Session removes the scratchpad, and `GOAL.json` with it.
