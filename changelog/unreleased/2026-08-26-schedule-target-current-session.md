# Scheduled tasks target the current Session by default

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `core`, `skills`
- **PR:** [#498](https://github.com/Prism-Shadow/penguin-harness/pull/498)

[中文版](2026-08-26-schedule-target-current-session.zh.md)

The built-in Schedules Prompt now tells the Agent to aim a scheduled task at the Session it is already in — `session_id` written from the Environment section's Session ID line — so a task arranged in conversation reports back into that conversation instead of into a fresh Session nobody is watching. Opening a new Session per trigger became the deliberate alternative: when the user asks for a separate Session, or when the task is better off starting clean.

## Details

- The `# Scheduled Tasks` field rules lead with `session_id` and its default, and the fenced example carries `session_id` alongside an `end_at`. `session_id` still cannot be combined with `workspace` / `provider` / `model_id`, and a file that omits `session_id` still opens a new Session on every trigger — the TOML format itself is untouched.
- A hygiene line bounds the shape the new default makes ordinary: a repeating task aimed at its own Session grows that Session's context on every trigger, so it asks for an `end_at`, a one-shot task for a one-time reminder, and small per-trigger work.
- The `penguin-orchestration` skill's `penguin schedule add` guidance follows the same default (`--session-id "$PENGUIN_SESSION_ID"`), and its runaway-loop caution names the bound that ends such a task.

## Existing Agents

The config kernel advanced to `2026-08-26`, moving the Schedules tab. An Agent already on disk keeps its stored `schedules.prompt` and runs the old guidance until its owner takes the kernel update on the Agent settings page; a Schedules tab still holding the previous built-in default is rewritten by that update, while an edited one is kept whole.
