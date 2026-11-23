/**
 * The keys a month grid moves by, after the ARIA date-grid pattern: the arrows a day or a week,
 * Home and End the week's first and last day, Page Up and Page Down a month — a year with Shift.
 * A move past the month's edge lands in the next month, which the grid then shows.
 */
import { addDays, addMonths, endOfWeek, startOfWeek } from "./calendar-date";
import type { CalendarDate, Weekday } from "./calendar-date";

/** The day `key` moves the focus to from `focus`, or null for a key the grid does not move by. */
export function gridKeyTarget(
  key: string,
  focus: CalendarDate,
  firstDay: Weekday,
  shift: boolean,
): CalendarDate | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(focus, -1);
    case "ArrowRight":
      return addDays(focus, 1);
    case "ArrowUp":
      return addDays(focus, -7);
    case "ArrowDown":
      return addDays(focus, 7);
    case "Home":
      return startOfWeek(focus, firstDay);
    case "End":
      return endOfWeek(focus, firstDay);
    case "PageUp":
      return addMonths(focus, shift ? -12 : -1);
    case "PageDown":
      return addMonths(focus, shift ? 12 : 1);
    default:
      return null;
  }
}
