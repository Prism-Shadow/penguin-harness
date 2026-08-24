# Subagents take mid-run messages and a per-run stop — from the model and from the panel

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#433](https://github.com/Prism-Shadow/penguin-harness/pull/433)
- **Issue:** [#272](https://github.com/Prism-Shadow/penguin-harness/issues/272), [#274](https://github.com/Prism-Shadow/penguin-harness/issues/274)

[中文版](2026-08-24-subagent-steering.zh.md)

A subagent used to be a fire-and-observe affair: `input_subagent` rejected a prompt while
the child was still running, and the panel offered no way to correct or stop a child at
all — stopping the main agent left its children running. Both gaps close with one
mechanism: the same steering channel a user already has into the main session, applied to
the child session, reachable by the model and the human alike.

## For the model (`input_subagent`)

- A `prompt` sent while the child **runs** is now injected mid-run as a steering message —
  delivered as a `[user_steering]` message at the child's next step, written to the child's
  Trace with sender `parent_agent`, streamed live to the panel. The old "still running"
  error is gone (it remains only for third-party SDK handles that predate steering).
- New `abort` argument: stops the child's **current run only**, like a user pressing stop —
  the session survives for steering and follow-up prompts, unlike `kill_subagent`'s
  terminate-and-remove. Combined with a `prompt`, the aborted run settles first and the
  prompt starts a fresh round: interrupt and redirect in one call.
- The `run_subagent` / `input_subagent` tool descriptions teach both gestures. The built-in
  default change advances the config kernel version (`2026-08-24`); existing Agents keep
  their stored descriptions until a kernel update or restore-defaults, while the behavior
  itself applies to every session immediately.

## For the user (subagents panel)

- The selected child's identity strip gains a **stop button** (visible while it runs), and
  the nested conversation gains a **message input**: steering while the child runs, a
  follow-up round while it is idle. Two new endpoints
  (`POST /api/sessions/:id/subagents/:childSessionId/steer|abort`) route through the parent
  session's active runtime into the same core channel `input_subagent` uses.
- Children are reachable from spawn — a child still inside `run_subagent`'s foreground
  window can be messaged and stopped too, not just backgrounded ones. The first host-path
  touch also attaches the live forwarding tap, so a panel-driven child streams to the
  frontend without waiting for the model's next poll.

## Live child states (issue #274)

Child running marks were previously inferred by parsing tool-output text
(`still running` / `idle` notes), which froze the checkmark, stopped the elapsed timer,
and flickered the status after `input_subagent` revived a finished child. Run state is now
structural: every child run start/settle pings the host, the server folds
`{sessionId, running}` of all live children into `task_state` events and the SSE subscribe
snapshot, and the panel consults that first — the text heuristics remain only as the
fallback for dead runtimes, old servers, and historical sessions. The delivered
`[user_steering]` message also keeps the queued input's sender, so the child's Trace
records who interjected.
