# Scheduled tasks target the current Session by default

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `core`, `skills`
- **PR:** [#498](https://github.com/Prism-Shadow/penguin-harness/pull/498)

[中文版](2026-08-26-schedule-target-current-session.zh.md)

The built-in Schedules Prompt now tells the Agent to aim a scheduled task at the Session it is already in — `session_id` written from the Environment section's Session ID line — so a task arranged in conversation reports back into that conversation instead of into a fresh Session nobody is watching. Opening a new Session per trigger became the deliberate alternative: when the user asks for a separate Session, when the task is better off starting clean, or when it has to outlive the conversation.

## Details

- The `# Scheduled Tasks` field rules now describe `session_id` and its default before the new-Session form, and the fenced example carries `session_id` alongside an `end_at`. `session_id` still cannot be combined with `workspace` / `provider` / `model_id`, and a file that omits `session_id` still opens a new Session on every trigger — the TOML format itself is untouched.
- The same rules name where this Session is the wrong target. A Session is not the durable identity of a conversation — switching the model or the agent opens a new one, and deleting the conversation strands a task bound to it — so anything that has to outlive the conversation takes the new-Session form. A subagent, which renders this same section against its own short-lived Session, omits `session_id` unless its caller gave it an id to target.
- A hygiene line bounds the shape the new default makes ordinary: a repeating task aimed at its own Session grows that Session's context on every trigger, so it asks for an `end_at` when the request has a natural horizon, a one-shot task for a one-time reminder, and small per-trigger work. An open-ended reminder keeps no `end_at`: the Agent leaves it off and says in its reply that the task runs until the user removes it, instead of inventing an expiry date the reminder would then silently stop on.
- The `penguin-orchestration` skill's `penguin schedule add` guidance follows the same default (`--session-id "$PENGUIN_SESSION_ID"`), and its runaway-loop caution names the bound that ends such a task, on the same condition.

## Existing Agents

The config kernel advanced to `2026-08-26`, moving the Schedules tab. An Agent already on disk keeps its stored `schedules.prompt` and runs the old guidance until its owner takes the kernel update on the Agent settings page; a Schedules tab still holding the previous built-in default is rewritten by that update, while an edited one is kept whole.
