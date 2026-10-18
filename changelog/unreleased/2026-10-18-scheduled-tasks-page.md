# A Project-wide scheduled-tasks page

- **Date:** 2026-10-18
- **Type:** feature
- **Scope:** `web`

[中文版](2026-10-18-scheduled-tasks-page.zh.md)

Scheduled tasks live in per-Agent files, and one Agent's Settings › Schedules tab was the only place that listed them, so a Project's whole schedule could not be read in one place. This added a top-level page — `/schedules`, the nav entry "Scheduled tasks" — that lists every Agent's tasks of the current Project, grouped by the Agent that owns each one, reading the same Project-wide listing the session list's alarm-clock marks read. The entry is pinned by default, so the page sits with the other pinned entries rather than behind the fold.

## Details

- The list carries two filters. The status chips are the chat dock's panel's own vocabulary, and a type picker names the interval in words — one-off, every few minutes, hourly, daily, weekly, custom — instead of the server's `30m` / `7d` grammar. Each chip shows its count, and the type is derived from the interval rather than stored, so no server change was needed.
- Both filters and the search box are written into the address (`?status=`, `?type=`, `?q=`), so a narrowed view survives a reload and can be handed to someone else; an unknown or stale value falls back to no filter. A blank filter leaves the address clean.
- A row opens the task in full: the whole prompt, the interval, the target Session, the start and end times, and the Workspace and model a new Session would open with. Editing hands the task to the shared form, which stays the only writer of a task file; enable/disable and delete sit beside it, owner-only like every other schedule write.
- The task name is a button as well as the row being clickable, so the detail view is reachable from the keyboard.
- Each Agent's group creates a task for that Agent, and the files that failed to parse are reported for every Agent at once — the Project-wide answer a per-Agent tab cannot give.
