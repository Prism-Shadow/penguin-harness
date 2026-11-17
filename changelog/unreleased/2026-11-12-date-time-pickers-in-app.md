# Every date and time field uses the shared pickers

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `ui`, `web`
- **PR:** [#1548](https://github.com/Prism-Shadow/penguin-harness/pull/1548)

[中文版](2026-11-12-date-time-pickers-in-app.zh.md)

Every field that used the browser's own date or time input moved to the shared UI package's pickers ([the pickers](2026-11-12-ui-date-time-pickers.md)), so the app has one look for a date, a time and a span, in every theme. The values stored and sent are unchanged.

## Details

- **A2UI forms**: a `date`, `time` or `datetime` field in a reply is the date, time or date-and-time picker; its answer keeps the grammar's format, so filling, drafts and answered forms read as before.
- **Cost Center**: one range picker replaced the two date inputs, and it shows only while the range Select is Custom: choosing Custom shows it holding the dates the range had, two presses on it and OK pick the span (2026年11月10日-2026年11月16日), and no day after today can be picked. A preset (the last hour, the last 24 hours, the last 7, 30 or 90 days) is chosen in the Select alone and shows no picker beside it.
- **Scheduled tasks** (the start and end) and the **company calendar's** events (the start and end) use the date-and-time picker; a **ticket's** due date, in the ticket dialog and the new-ticket form, uses the date picker.
- **Exporting an Agent**: the Traces date range is one range picker in place of the two date inputs.
