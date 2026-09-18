---
title: Goal Mode
description: Give an agent an objective and let it keep working until the goal is complete, blocked, or out of Token budget.
---

Goal mode lets you give an agent an objective instead of a single message. The harness keeps running Tasks on the same Session, round after round, until the goal is complete, blocked, or out of Token budget. The model cannot end a goal by simply replying: it has to claim completion, or a real impasse, through the protocol described in [How a goal runs](#how-a-goal-runs).

- To start a goal from the Web App, the CLI, or the API, see [Start a goal](#start-a-goal).
- To see what happens in each round and how a goal ends, see [How a goal runs](#how-a-goal-runs).
- To cap what a goal can spend, see [Token budget](#token-budget).
- To end a goal early, see [Stop a goal](#stop-a-goal).
- To read a goal's progress from the API, see [Check a goal's state](#check-a-goals-state).

## Start a goal

**Before you begin**

- The agent has the `goal` plugin installed. It comes preinstalled on `default_agent`; install it on any other agent from the plugin library.
- The agent's hooks are on: **Enable hooks** on the agent's **Hooks** tab. Hooks are on unless the Project owner switched them off.

Without the plugin, or with hooks off, the agent cannot start a goal. The Web App and the API report `409 goal_plugin_not_installed` instead of running a Task that would simply end.

### From the Web App

1. In the composer, open the `+` menu and select **Goal mode**, or type `/goal`.
2. Optional: on the goal chip, select the budget (it reads **Budget unlimited**), enter a **Token budget** such as `500k` or `2m`, and select **Save budget**. Leave it blank for no limit.
3. Write your objective as the message and send it.

Skills you select in the composer are added to the first round's message as a `[use_skills]` block, exactly like a normal send. While the goal runs, a banner above the composer shows the objective, the round, the Tokens used against the budget, and the goal's status.

### From CLI chat

In `penguin chat`, enter:

```
/goal[:<budget>] <objective>
```

For example:

```
/goal:500k make all tests pass
```

### From a one-shot run

```
penguin run --goal [budget] -m "<objective>"
```

The command exits with code 0 only when the goal completes.

### From the Server API

Send `POST /api/sessions/:id/tasks` with the body `{ input, goal: { budget } }`. Omit `budget`, or set it to `-1`, for no limit.

## The goal file

A goal's state lives in a file at `<agent_dir>/scratchpad/<session_id>/GOAL.json`, next to the model's `PLAN.md`. The file is created when the goal starts, and the stop hook rewrites it after every round.

```json
{
  "objective": "make all tests pass",
  "status": "active",
  "budget": 500000,
  "round": 3,
  "tokens_used": 123456
}
```

| Field | Written by | Meaning |
| --- | --- | --- |
| `objective` | The start script | The text every later round re-injects. |
| `status` | The model, or the hook | `complete` and `blocked` are the model's: they are its only way to talk back to the loop, and `status` is the only field it may touch. `active`, `wrapping_up` (the wrap-up round after the budget runs out), `budget_limited` and `aborted` are the hook's. |
| `budget` | The start script | The Token budget for the whole goal. `-1` means no limit. |
| `round` | The hook, every round | The round in progress. Once the status is terminal, the number of rounds that ran. |
| `tokens_used` | The hook, every round | Uncached input plus output Tokens the main Session has used so far, read from the Trace. |
| `ended` | The hook, at the end | `true` once the hook has acted on a terminal status. This tells a goal that this run just ended apart from one an earlier run ended; the hook stays silent about the latter. |

The file always holds the goal's current state, and the Web server restores the chat page's goal banner straight from it.

> [!NOTE]
> A broken file stops the goal instead of looping forever. A file that no longer parses stops the goal as `blocked` and is renamed to `GOAL.json.broken`. A `status` value outside the protocol also counts as `blocked`.

## How a goal runs

Each round starts with a protocol message: plain user text stamped `sender: "harness"`, with no marker block. The stamp alone marks it as sent by the harness. In the Web App it appears as a compact collapsed card, **Injected by the harness**, in the same form as background notices; expand the card to read the full text.

Round 1 sends your own message first, exactly as you wrote it, with its text, images and skill-invocation blocks. The protocol message follows it and points back at your message as the objective. Later rounds restate the objective from the goal file.

The protocol message embeds the `GOAL.json` the hook has just written, including the round, the Tokens used and the budget, so the model sees exactly the file it is asked to edit. It also sets the working rules:

- Verify completion against evidence before claiming it.
- Do not shrink the objective to an easier subset.
- Record key progress in `PLAN.md`, so it survives context compaction.

When the Task ends, the stop hook reads the Trace and the goal file, and acts on the first case that matches:

1. **The file says `complete`.** The goal is done.
2. **The file says `blocked`.** The model's final reply says what it needs from you. The rules require the same blocking condition to persist for three consecutive rounds before the model may claim `blocked`, so a passing obstacle does not end the goal.
3. **The Task was cut off**: an `abort` event from a user stop, a last request that failed for good, or the per-Task `max_turns` notice. The goal ends as `aborted`. The model never got to write the file, and another round would hit the same cutoff.
4. **The wrap-up round just ran.** The goal ends as `budget_limited`.
5. **100 rounds have run.** The goal ends as `aborted`. This backstop catches a goal with no budget, or a very large one, whose model never writes the file.
6. **The budget is used up.** One wrap-up round runs next.
7. **Otherwise**, the next round starts.

### Images in an objective

An objective can include images. They are sent in round 1 as ordinary input, and the model sees them then. Later rounds re-inject only the objective text.

An image cannot replace the text: a picture alone does not state an objective, so a goal input without text is rejected. File attachments are refused, because nothing carries them from one round to the next.

## Token budget

The budget counts **uncached input plus output** Tokens. After each round, the hook adds that round's usage, read from the Trace, to `tokens_used`. Subagent Sessions have their own Traces and are not counted.

The count estimates spend; it is not a bill. Cache reads also cost money, but only a small fraction of the uncached input price. Leaving them out keeps the number a fair approximation without per-model price tables.

The budget is checked between rounds. When it runs out, the goal is not cut off mid-thought. One final wrap-up round runs instead: the model summarizes its progress, lists the remaining work, and leaves a clear next step, and it must not claim `complete` just because the budget ran out. The hook then ends the goal as `budget_limited`. A truthful `complete` written during the wrap-up round still counts.

> [!NOTE]
> A round already running is never cut short, so actual spend can exceed the budget by up to one round, plus the wrap-up round.

With no budget, the goal runs until the model claims `complete` or `blocked`. That depends on the model reporting those two states honestly, with a hard stop after 100 rounds.

## Stop a goal

Stopping the current Task ends the whole goal:

- In the Web App, use the regular stop button.
- In the CLI, press Ctrl-C.

Your interruption outranks the hook. After a cutoff, no `continue` ever runs, and the goal ends as `aborted`; the goal file records that too.

## Check a goal's state

Send `GET /api/sessions/:id/goal`. The server reads the Session's `GOAL.json` and returns `{ goal: { objective, status, budget, used, rounds } }`, or `{ goal: null }` when the Session has never run a goal.

A goal lives only as long as its run. If the file shows a goal the hook has not ended but the Session is not running, a crash or a killed process left it behind, and it reads as `aborted`.

While a goal runs, live progress arrives on the Session's SSE channel as `goal_started`, `goal_round` and `goal_finished` events.

Deleting the Session deletes its scratchpad, and `GOAL.json` with it.

## How it works

### The goal plugin

Goal mode is not built into the core. The `goal` plugin is a [hook package](/skills#hook-packages) with two scripts:

- `start.mjs` is its [`user_prompt` hook](/agent-loop#user-prompt-hooks). It writes the goal file and answers the submitted prompt with round 1's protocol message as its expansion `context`.
- `stop.mjs` is a [stop hook](/agent-loop#stop-hooks). After every Task it reads the Session's Trace and answers `continue` with the next round's message, or `stop`.

Nothing in the core SDK knows what a goal is. The loop that consults hooks is generic.

### Starting a goal

The server asks the Session to run the goal package's `user_prompt` hook: the installed `agent_state/hooks/goal/start.mjs`, which receives `{ hook: "user_prompt", session_id, scratchpad_dir, prompt, budget }` on stdin. The server then starts the goal run with your message exactly as typed, followed by the `{ context }` the script prints, stamped `sender: "harness"`. The stop hook takes it from there.

In the SDK, a goal is therefore a plain `session.run` on an agent with the plugin installed. You start it by writing the goal file the same way: call `Session.runUserPromptHook("goal", …)`, or run the script directly.

### Counting and recording

For each round, the hook adds `request.total − cache_read` from every `token_usage` record since the round's harness-injected input.

Every answer the stop hook gives is recorded as a `hook` event (`name: goal`) on the stream and in the Trace. Its `output` carries the file's state: `status`, `round`, `tokens_used` and `budget`. Terminal statuses are written to the file as well, so the file and the last event agree.

### Server state

The Web server keeps no goal table. The goal endpoint reads the Session's `GOAL.json` directly. The SSE events are derived from the stream: the round inputs and the goal hook's events.
