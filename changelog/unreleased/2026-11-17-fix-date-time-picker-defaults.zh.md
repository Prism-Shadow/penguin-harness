# UI：修复 `DateTimeField` 跨边界调时间丢值及点选“今天”不关闭年月菜单的问题

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1602](https://github.com/Prism-Shadow/penguin-harness/pull/1602)

[English](2026-11-17-fix-date-time-picker-defaults.md)

当“今天”落在 `[min, max]` 之外时，在 `DateTimeField` 中未先选日期而直接转动时间滚轮会让刚选的时间被边界覆盖；当月历的月份或年份菜单打开时点击“今天”，日期网格仍被菜单遮住。

## 细节

- `DateTimeField`（`packages/ui/src/components/forms/date-time/date-time-field.tsx`）现在用 `clampDate(today, low, high)` 作为 `MonthCalendar` 的 `initial` 与 `TimeWheels` 的 `onChange` 默认日期，在 `min` 位于未来或 `max` 位于过去时保留滚轮选出的时分。
- `MonthCalendar`（`packages/ui/src/components/forms/date-time/month-calendar.tsx`）现在在外部 `selected` 变化（如在 `DateTimeField` 中点击“今天”）跳转焦点时把 `menu` 重置为 `null`。
- 在 `packages/ui/test/date-picker.dom.test.ts` 中补充了未来 `min`、过去 `max` 下转动时间滚轮及翻月打开月份菜单后点击“今天”的 DOM 测试。
