# UI: keep time-wheel picks within bounds in `DateTimeField` and close open calendar menus on `Today`

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1602](https://github.com/Prism-Shadow/penguin-harness/pull/1602)

[中文版](2026-11-17-fix-date-time-picker-defaults.zh.md)

Picking a time on the wheels before picking a date in `DateTimeField` lost the chosen time whenever today fell outside `[min, max]`, and using the `Today` shortcut while the calendar's month or year menu was open left the day grid hidden behind the menu.

## Details

- `DateTimeField` (`packages/ui/src/components/forms/date-time/date-time-field.tsx`) now clamps today with `clampDate(today, low, high)` as the default date for both `MonthCalendar` `initial` and `TimeWheels` `onChange`, so wheel edits keep the selected hour and minute when `min` is in the future or `max` is in the past.
- `MonthCalendar` (`packages/ui/src/components/forms/date-time/month-calendar.tsx`) now resets `menu` to `null` when an external `selected` update (such as clicking `Today` in `DateTimeField`) moves focus to the selected date.
- Added DOM tests in `packages/ui/test/date-picker.dom.test.ts` covering wheel picks with future `min` and past `max`, and clicking `Today` while the month menu is open after paging away.
