# Every date and time field uses the shared pickers

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `ui`, `web`

[中文版](2026-11-12-date-time-pickers-in-app.zh.md)

Every field that used the browser's own date or time input moved to the shared UI package's pickers ([the pickers](2026-11-12-ui-date-time-pickers.md)), so the app has one look for a date, a time and a span, in every theme. The values stored and sent are unchanged.

## Details

- **A2UI forms**: a `date`, `time` or `datetime` field in a reply is the date, time or date-and-time picker; its answer keeps the grammar's format, so filling, drafts and answered forms read as before.
- **Cost Center**: the custom range is one range picker in place of the two date inputs, offering the calendar presets (last 7, 30 and 90 days) as chips; picking one switches the range back to that preset.
- **Scheduled tasks** (the start and end) and the **company calendar's** events (the start and end) use the date-and-time picker; a **ticket's** due date, in the ticket dialog and the new-ticket form, uses the date picker.
- **Exporting an Agent**: the Traces date range is one range picker in place of the two date inputs.
