# Every date and time field uses the shared pickers

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `ui`, `web`
- **PR:** [#1548](https://github.com/Prism-Shadow/penguin-harness/pull/1548)

[中文版](2026-11-12-date-time-pickers-in-app.zh.md)

Every field that used the browser's own date or time input moved to the shared UI package's pickers ([the pickers](2026-11-12-ui-date-time-pickers.md)), so the app has one look for a date, a time and a span, in every theme. The values stored and sent are unchanged.

## Details

- **A2UI forms**: a `date`, `time` or `datetime` field in a reply is the date, time or date-and-time picker; its answer keeps the grammar's format, so filling, drafts and answered forms read as before.
- **Cost Center**: one range picker replaced the two date inputs, and it shows beside every calendar range, not only Custom: it reads the range's two dates in full (2026年11月10日-2026年11月16日), two presses on it pick a custom range, no day after today can be picked, and its chips are the calendar presets (last 7, 30 and 90 days), one of which switches the range back to that preset. The last hour and the last 24 hours, trailing windows with no dates of their own, keep the Select alone.
- **Scheduled tasks** (the start and end) and the **company calendar's** events (the start and end) use the date-and-time picker; a **ticket's** due date, in the ticket dialog and the new-ticket form, uses the date picker.
- **Exporting an Agent**: the Traces date range is one range picker in place of the two date inputs.
