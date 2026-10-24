# Fire a scheduled task once by hand

- **Date:** 2026-10-18
- **Type:** feat
- **Scope:** `server`, `cli`, `web`, `docs`
- **PR:** [#1200](https://github.com/Prism-Shadow/penguin-harness/pull/1200)

[中文版](2026-10-18-schedule-manual-fire.zh.md)

A scheduled task can now be fired once right now, outside its schedule: `penguin schedule run
<name>`, a Run now button on the agent settings Schedules tab and in the chat dock panel's row
menu, and `POST .../schedules/:name/fire` underneath them.

## Details

- A manual firing is an extra run that never consumes the schedule itself: only the last-fired
  time advances, no slot is consumed, and a one-shot's real firing still happens afterwards.
- Dispatch matches a due slot — the bound Session or a fresh one — and queues behind a busy
  target, reporting `{ sessionId, queued }`.
- Disabled tasks fire alike; settled ones (done/missed/expired) are archived and report
  `schedule_not_found` like every other listing. Unparsable files, broken model references and
  lost bound Sessions fail with coded 400s (`schedule_invalid`, `schedule_session_missing`).
- Firing is owner-only, like every other schedule write.
