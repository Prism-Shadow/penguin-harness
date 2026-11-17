/**
 * Calendar arithmetic on plain dates and wall-clock times: the values the date and time pickers
 * read and write. A value is the string a native input holds — `YYYY-MM-DD`, `HH:mm`,
 * `YYYY-MM-DDTHH:mm`, local and without a zone — so a caller that swaps a native input for a
 * picker stores exactly what it stored before.
 *
 * Every step works on the year, month and day as integers and reads a weekday through UTC, never
 * through the reader's zone. A `Date` made at local midnight and read back through `toISOString`
 * lands on the day before anywhere west of Greenwich, and a day that opens with a daylight-saving
 * jump has no local midnight at all; neither can happen to a day that never meets a zone. The one
 * place the reader's zone is read is "now" (`todayOf`, `clockOf`), which is what today means.
 */

export interface CalendarDate {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

export interface ClockTime {
  /** 0–23. */
  readonly hour: number;
  /** 0–59. */
  readonly minute: number;
}

/** A month on the calendar: what a month grid shows. */
export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

/** A weekday as `Date.getUTCDay` counts it: 0 is Sunday, 1 Monday … 6 Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_VALUE = /^(\d{2}):(\d{2})$/;
const DATE_TIME_VALUE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/**
 * The instant at noon UTC of a calendar day. `setUTCFullYear` rather than `Date.UTC`, which reads
 * a two-digit year as 19xx; an out-of-range month or day rolls over, which is what the steps
 * below rely on.
 */
export function utcNoon(year: number, month: number, day: number): Date {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(12, 0, 0, 0);
  return at;
}

function fromUtc(at: Date): CalendarDate {
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return utcNoon(year, month + 1, 0).getUTCDate();
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A `YYYY-MM-DD` value as a date, or null when it is not one (a month 13, a 31 April). */
export function parseDate(value: string): CalendarDate | null {
  const match = DATE_VALUE.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function dateValue(date: CalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** An `HH:mm` value as a time, or null when it is not one. */
export function parseTime(value: string): ClockTime | null {
  const match = TIME_VALUE.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function timeValue(time: ClockTime): string {
  return `${pad(time.hour)}:${pad(time.minute)}`;
}

/** A `YYYY-MM-DDTHH:mm` value as its date and time, or null when it is not one. */
export function parseDateTime(value: string): { date: CalendarDate; time: ClockTime } | null {
  const match = DATE_TIME_VALUE.exec(value);
  if (match === null) return null;
  const date = parseDate(match[1]!);
  const time = parseTime(match[2]!);
  return date === null || time === null ? null : { date, time };
}

export function dateTimeValue(date: CalendarDate, time: ClockTime): string {
  return `${dateValue(date)}T${timeValue(time)}`;
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function sameDate(a: CalendarDate | null, b: CalendarDate | null): boolean {
  return a !== null && b !== null && compareDates(a, b) === 0;
}

export function compareTimes(a: ClockTime, b: ClockTime): number {
  return a.hour - b.hour || a.minute - b.minute;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtc(utcNoon(date.year, date.month, date.day + days));
}

/** The same day `months` later, held to the last day of a shorter month (31 January → 28 February). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function weekdayOf(date: CalendarDate): Weekday {
  return utcNoon(date.year, date.month, date.day).getUTCDay() as Weekday;
}

/** The first day of `date`'s week, for a week that starts on `firstDay`. */
export function startOfWeek(date: CalendarDate, firstDay: Weekday): CalendarDate {
  return addDays(date, -((weekdayOf(date) - firstDay + 7) % 7));
}

/** The last day of `date`'s week, for a week that starts on `firstDay`. */
export function endOfWeek(date: CalendarDate, firstDay: Weekday): CalendarDate {
  return addDays(startOfWeek(date, firstDay), 6);
}

/**
 * The six weeks a month grid draws: the week holding the 1st first, every day as a date, the days
 * of the months on either side included so each row is a whole week. Always six rows, so the grid
 * keeps its height from one month to the next.
 */
export function monthWeeks(month: CalendarMonth, firstDay: Weekday): CalendarDate[][] {
  const start = startOfWeek({ year: month.year, month: month.month, day: 1 }, firstDay);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  );
}

export function inMonth(date: CalendarDate, month: CalendarMonth): boolean {
  return date.year === month.year && date.month === month.month;
}

/** Whether `date` lies within the bounds, each end included; a missing bound holds nothing back. */
export function withinBounds(
  date: CalendarDate,
  min: CalendarDate | null,
  max: CalendarDate | null,
): boolean {
  return (
    (min === null || compareDates(date, min) >= 0) && (max === null || compareDates(date, max) <= 0)
  );
}

/** `date` moved inside the bounds. */
export function clampDate(
  date: CalendarDate,
  min: CalendarDate | null,
  max: CalendarDate | null,
): CalendarDate {
  if (min !== null && compareDates(date, min) < 0) return min;
  if (max !== null && compareDates(date, max) > 0) return max;
  return date;
}

/** Today on the reader's own calendar. */
export function todayOf(now: Date): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** The reader's clock now, to the minute. */
export function clockOf(now: Date): ClockTime {
  return { hour: now.getHours(), minute: now.getMinutes() };
}

/** `time` moved down onto a multiple of `step` minutes (a step of 1 leaves it as it is). */
export function floorToStep(time: ClockTime, step: number): ClockTime {
  return { hour: time.hour, minute: time.minute - (time.minute % Math.max(1, step)) };
}
