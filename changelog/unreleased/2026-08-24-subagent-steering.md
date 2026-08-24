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
- `input_subagent`'s model-facing output is now the child's **most recent complete reply** —
  an idempotent "what it last said" snapshot on every access, instead of an incremental
  delta drain (completion reports carry the same snapshot; the frontend's live rendering
  still flows through the origin-tagged messages).
- A released `subagent_id` **revives automatically** when the model messages it again: the
  registry keeps a tombstone (child session id + spawn-time agent) per registration, and the
  same resume path the panel uses brings the session back under the same id. The only error
  left is an id this conversation never allocated.
- The tool descriptions teach all of it. The built-in default change advances the config
  kernel version (`2026-08-24`); existing Agents keep their stored descriptions until a
  kernel update or restore-defaults, while the behavior itself applies to every session
  immediately.

## No kill for subagents; commands fold kill into input_command

A subagent session is like the main agent: always resumable, never destroyed — so the kill
notion is gone. `kill_subagent` is **removed** (stopping a run is `abort`; releasing an idle
session is just freeing its slot, and a released id revives on the next message). A command's
process IS a real OS object that gets destroyed, so its termination becomes a parameter:
`kill_command` merges into `input_command` as `kill: true` (disarm the completion report,
drain undelivered output, SIGTERM→SIGKILL the process group, drop the session — exactly the
old tool's behavior). No backward compatibility is kept for the two removed tool names: a
stale stored config's entries simply stop assembling, and a model calling them gets the
standard unknown-tool failure. An explicitly aborted subagent round also sends no completion
report — the aborter reads the outcome directly.

## For the user (subagents panel)

- The selected child is driven by the **same composer as the main conversation** (a subagent
  variant of the one component): text body, skills and slash skill commands, a per-turn
  thinking level (applies to the round the message starts), the context ring showing the
  child's own usage, the locked-model badge, and the approval-mode selector — which edits
  the parent session's mode, the one child approvals are judged by. The stop control is the
  composer's running-state stop face, right where the main conversation has it. Goal mode,
  image/file attachments, `/model`, `/agent`, `/compact` and the follow-up queue are not
  offered — a child has no semantics for them.
- A message is a user input on the child **whatever its state**: steering while it runs, a
  follow-up round while it is idle — and when the session was already released (finished in
  a foreground window, killed, or the server restarted), it is **revived** through the
  resume-session path: same history, model and Workspace, re-managed under the parent (the
  model can address it again by its `subagent_id`), and the message starts its next round.
  "This subagent has ended" is no longer a dead end; the only error left is a session whose
  record no longer exists.
- Two endpoints serve this (`POST /api/sessions/:id/subagents/:childSessionId/message` with
  optional `thinkingLevel`, and `…/abort`), routed through the parent session's runtime —
  loaded on demand like a task would, so it works after a restart. Children are reachable
  from spawn (a child still inside `run_subagent`'s foreground window included), and the
  first host-path touch attaches the live forwarding tap, so a panel-driven child streams
  to the frontend without waiting for the model's next poll.
- The panel stays put: it shows the most recent Task that actually spawned subagents, so a
  plain follow-up message no longer wipes the graph — a new Task takes the panel over the
  moment it spawns its own child.
- The thinking picker shows what the child actually runs at while untouched: the user's own
  pick for this child, else the spawning call's explicit `thinking_level`, else the parent
  session's effective level (what the child inherited); only an explicit pick rides the send.
- A panel-started round sends **no background completion report** to the main conversation:
  reports cover model-initiated rounds only (the `run_in_background` launch and
  `input_subagent` follow-ups) — the user talking to a child is not dispatched work, and the
  main agent no longer receives "background task finished" notices for it. The round's
  answer text stays in the model-facing buffer for the model's next poll.

## Child approvals reach the user

A background child that hit a tool approval used to get auto-denied — the parent task's end
converged every pending approval, and a child with no active poll window had no way to ask.
Both halves are fixed: the web server now attaches a session-lifetime fallback approval sink
(child approvals with no window and no background-launch standing sink escalate to the user
as ordinary approval cards, the parent session sitting idle included), and a parent task
ending or being stopped converges only the **main** session's approvals — an origin-tagged
child approval stays pending, and its card stays rendered, until the user decides. The CLI
keeps the poll-window-only semantics (it attaches no fallback sink).

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
