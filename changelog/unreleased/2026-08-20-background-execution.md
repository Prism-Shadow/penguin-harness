# Background execution with completion reports, and kill tools

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#376](https://github.com/Prism-Shadow/penguin-harness/pull/376)

[中文版](2026-08-20-background-execution.zh.md)

Added a `run_in_background` argument to `exec_command` and `run_subagent`: the call returns its `process_id` / `subagent_id` immediately, and when the task settles its result comes back **as a user message injected by the harness** — the model no longer needs to poll. Added `kill_command` and `kill_subagent` to terminate background sessions, and raised `input_command`'s default empty-poll wait from 5000ms to 120000ms so one poll waits out most builds.

## Details

- The completion report opens with a `[background_task_done]` marker block (kind, id, status, one-line detail) followed by what ran and the tail of its yet-undelivered output (capped at 4000 characters). The Web App collapses the block into a one-line notice with the report body below it.
- Delivery: while a Task is running, the report rides the next turn boundary — a Task whose final reply already streamed continues for one more turn to react to it. While the Session is idle, the server starts a new Task carrying the report; SDK embedders subscribe via `Session.onBackgroundNotice` / `takeBackgroundNotices`, and with no subscriber the report joins the next run's input.
- `kill_command` SIGTERMs the whole process group (SIGKILL after a grace period) and returns the output not yet delivered; `kill_subagent` aborts the run, denies its pending approvals, and removes the session (an idle one too, freeing its concurrency slot). A killed task sends no completion report — the kill's own result carries the outcome.
- User-role `text` payloads gained an optional `sender` field (`"user" | "parent_agent" | "harness" | "server"`): subagent prompts written by the parent agent are recorded as `sender: "parent_agent"` in the child's Trace, harness-injected completion reports as `sender: "harness"`, and the server's scheduled-task triggers as `sender: "server"`. The field is additive — absent means the human user, which is also the correct reading of every Trace written before it existed — so no migration and no compatibility code is involved, and it never reaches the provider wire.
- The kernel version advanced to `2026-08-20`; existing agents adopt the new tools and arguments through the settings page's kernel update (user customizations kept), or keep their stored toolset untouched if they never run it.
