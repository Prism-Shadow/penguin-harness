# Stop hooks replace the goal loop, and a second hook feeds long sessions back into skills

- **Date:** 2026-08-29
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#542](https://github.com/Prism-Shadow/penguin-harness/pull/542)
- **Breaking:** yes

[中文版](2026-08-29-stop-hook-goal-mode.zh.md)

The Session gained a hook mechanism — functions it runs at fixed points of the agent loop, with one point so far: **stop**, the moment a Task ends. Goal mode was rebuilt on it as one hook, in the shape of a ralph loop: the goal file is the state, the hook reads it after every Task and either injects the next round or ends the goal. The dedicated goal loop and its `goal_finished` message are gone; what a hook answers is recorded as a generic `hook` event. A second built-in hook uses the same point to hand a long session's findings to a background subagent that folds them into the Agent's skills.

## Stop hooks

- `SessionConfig.hooks.stop` takes a list of named hooks. After every Task of a `run` call each one receives the Trace file being written, how the Task ended (`completed` / `aborted` / `fatal`), the run's Task count and uncached-token spend (subagent sessions included), the Session's cumulative turn count, and the run's approval callback.
- A hook answers `continue` (with the next Task's user text as `input`), `stop`, or nothing. Every answer becomes one `hook` event message — `hook`, `name`, `decision`, `reason`, and the hook's own scalar `output` — streamed and written to the Trace; the injected input is not in the event, it is the user message that follows it. The first `continue` drives another Task inside the same `run` call; after a cutoff, or once the signal is aborted, a `continue` is recorded but never run. A throwing hook is recorded with the error as its reason and cannot take the run down.
- The trace page renders `hook` events with their name, decision, reason and record; the CLI prints one dim line per hook answer (the goal hook's excluded — its own round and summary lines already say what it decided).

## Goal mode as a hook

- `session.run(input, { goal: { budget } })` writes `GOAL.yaml`, yields and runs the round-1 `[goal]` message, and puts the goal hook ahead of the run's stop hooks. The file now holds the whole state — `objective`, `status`, `budget`, `round`, `tokens_used` — and the hook rewrites it after every round; the model still owns `status` alone (`complete` / `blocked`), and `objective` / `budget` are re-asserted from the hook's own copy on every write. The `[goal]` block embeds that file, numbers included, in place of its separate budget line.
- The decision order: the model's verdict wins; a cut-off Task ends the goal as `aborted`; the wrap-up round ends it as `budget_limited`; 100 rounds are the runaway backstop; a reached budget buys one wrap-up round; otherwise the next round. Terminal statuses are written to the file too, so the file and the last event always agree. A broken file stops the goal as `blocked` and is left untouched.
- Hosts read the outcome from the hook's `stop` event: `goalOutcomeOf` replaces `goalFinishedOf`, `goalProgressOf` reads every goal hook event, and `isGoalRoundInput` is unchanged. `GoalRunOptions.maxRounds` is gone (the backstop is a constant, never a host knob).
- The Web server keeps no goal table: `GET /api/sessions/:id/goal` reads the Session's `GOAL.yaml`, and a file still active while the Session is not running reads as `aborted` — a goal lives only inside its run, so the startup reconciliation went with the table. The `goal_started` / `goal_round` / `goal_finished` server events and the chat page's banner are unchanged; `goal_round`'s `used` is now what the hook recorded rather than a second count.

## The skill-summary hook

- Configured by `hooks.skill_summary` in `system_config.yaml` — `enabled` (default true) and `min_turns` (default 20) — and registered on top-level Sessions only. Once the Session has run `min_turns` LLM turns, the hook reads the current Trace file after every Task, takes the records since the last summary it recorded there, and fires when that window holds `min_turns` completed turns. The Trace is its only state: a restart changes nothing, and a compaction (which rotates the file) starts a fresh window.
- It condenses the window into an excerpt — user and assistant text, tool calls with arguments, tool outputs, each clipped, the oldest lines dropped past 60k characters, no thinking or images — and spawns a background child Session of the same Agent through the subagent runner (no `run_subagent` slot, no panel entry, no completion notice; the child has its own Trace and inherits the run's approval callback). The prompt names the skills directory and the skills the window invoked and asks the child to fold durable findings into the relevant `SKILL.md` files, bumping their version, or to change nothing. The hook records the child's session id and the window's turn count in its `hook` event. An Agent with no installed skill never fires it.

## Compatibility

- **`goal_finished` no longer exists**: the `GoalFinishedPayload` type, the `goalFinished` builder and `goalFinishedOf` / `goalTokenDelta` are removed. Consumers read the goal hook's `hook` event (`name: goal`, `decision: stop`) with `goalOutcomeOf`; the run's accounting rule is `uncachedTokens`. Traces written by earlier versions still carry `goal_finished` records; readers that switch on the payload type treat them as an unknown event (the trace page shows them without a summary line).
- **`GOAL.yaml` has a new shape**: `budget`, `round` and `tokens_used` join `objective` and `status`, and system-side endings are written to `status`. A file left by an earlier version is read tolerantly (missing counters read as zero) and matters only to `GET /goal`, which reports it as `aborted` unless the Session is running.
- **The `goal_state` table is no longer created, written or read.** An existing `web.db` keeps its rows; nothing depends on them, and the table can be dropped by hand.
- **The skill-summary hook is on by default**, for existing Agents too — an Agent whose `system_config.yaml` predates the `hooks` section runs it at the defaults. Each firing spends one background subagent run on the session's excerpt; set `hooks.skill_summary.enabled: false` to turn it off, or raise `min_turns`.
