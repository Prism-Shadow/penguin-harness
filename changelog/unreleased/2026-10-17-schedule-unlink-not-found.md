# Deleting a schedule reports not-found only when the file is gone

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `server`

[中文版](2026-10-17-schedule-unlink-not-found.zh.md)

DELETE of a scheduled task no longer answers `schedule_not_found` for every filesystem error. Only a missing file is 404; a permission or other unlink failure surfaces as the error it is, instead of telling the caller the task was already gone.

## Details

- `deleteScheduleFile` returns false only on ENOENT, matching its own comment and the organization store's calendar-event delete.
