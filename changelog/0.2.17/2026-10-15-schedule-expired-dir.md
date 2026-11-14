# Finished scheduled tasks move to `schedule/expired/`

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`, `skills`
- **PR:** [#1159](https://github.com/Prism-Shadow/penguin-harness/pull/1159)
- **Breaking:** yes — a one-shot task whose start time has already passed is refused (400) instead of firing once immediately

[中文版](2026-10-15-schedule-expired-dir.zh.md)

The scheduler now archives scheduled tasks that can never fire again: a one-shot task that has
fired (`done`), a one-shot task whose time passed while the server was down (`missed`), and a task
past its `end_at` (`expired`). Each one's file is moved, unchanged, into the agent's
`agent_state/schedule/expired/`, and its SQLite run state is dropped as if the file had been
deleted.

## Details

- Reconcile and the schedule listings both archive. A one-shot task moves right after it fires,
  before `schedule_fired` is sent, so the refetch that event triggers no longer lists it. A task
  with a queued fire stays until that fire is sent.
- An archived task leaves every list and count: the agent's Schedules tab and its card's
  `scheduleCount`, the chat dock's Scheduled tasks panel, the sidebar alarm clock mark, the
  schedules API, `penguin schedule ls`, and the agent's `{{SCHEDULE_LIST}}` roster from its next
  model context.
- When `expired/` already holds a file of that name, the moved file takes a UTC timestamp suffix
  (`<name>.20261015T093000Z.toml`, then `-2`, `-3`…); nothing is overwritten. A failed move is
  recorded as `schedule_archive_failed`, and the task stays listed until a later pass moves it.
- Tasks that are invalid (bound Session deleted) or disabled are not archived.
- Moving a file back into `schedule/` registers it as a new task; one whose times are still past is
  archived again.
- Tasks already settled on disk move on the first reconcile after the upgrade, by the same rule.
- `POST` and `PUT` on the schedules API return 400 for a one-shot task whose `startAt` has
  passed, and for any task whose `endAt` has passed. The CLI and the Web form get the same
  refusal, so `penguin schedule add --start-at now` now needs `--period`.
- The Scheduled tasks panel dropped its **Completed** filter, keeping **All**, **Active** and
  **Paused**.
- The Scheduled tasks, Agents, CLI, Configuration and Server API docs, the CLI help, the Create
  with AI prompt and the `penguin-orchestration` Skill describe the archive and the new refusals.

## Compatibility

- A one-shot task whose `startAt` has already passed used to fire immediately:
  `penguin schedule add <name> --start-at now` without `--period`, and the same request from the
  form or the API. It is now refused with 400; give a future start time.
- Switching a disabled one-shot task back on after its time has passed used to fire it immediately;
  that is now refused too. Change its start time first.
- Files on disk are never rewritten. Tasks already settled move into `expired/` as described
  above.
