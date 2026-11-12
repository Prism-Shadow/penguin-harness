/**
 * How the pickers write dates and times for a reader: the locale's own shapes from
 * `Intl.DateTimeFormat` (2026年11月12日 / Nov 12, 2026; 14:30 / 2:30 PM), the weekday a week
 * starts on, and whether the clock runs to 12 or 24 hours.
 *
 * Every value is formatted as the wall-clock reading it is, through UTC: a date or a time picked
 * in a form names no zone, and a formatter given the reader's zone would move it across a
 * daylight-saving gap or onto the day before. Formatters are built once per locale and shape.
 */
import { compareDates, utcNoon } from "./calendar-date";
import type { CalendarDate, CalendarMonth, ClockTime, Weekday } from "./calendar-date";

/** A clock face: 12 hours with a day period, or 24. */
export type HourCycle = "h12" | "h23";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, found);
  }
  return found;
}

/** The instant a date (and time) reads as on a UTC clock: what the formatters below are handed. */
function instant(date: CalendarDate, time?: ClockTime): Date {
  const at = utcNoon(date.year, date.month, date.day);
  if (time !== undefined) at.setUTCHours(time.hour, time.minute, 0, 0);
  return at;
}

/** A day on the reference date the time-only formats read (any day without a zone shift will do). */
const CLOCK_DAY: CalendarDate = { year: 2026, month: 1, day: 5 };

/** What `Intl.Locale` reports about the week, where the engine knows (`getWeekInfo` or `weekInfo`). */
interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
}

/** Regions whose week starts on Sunday, for an engine that cannot say (Firefox before weekInfo). */
const SUNDAY_REGIONS = new Set(["US", "CA", "JP", "IL", "BR", "MX", "PH", "KR", "TW", "HK"]);

/** The weekday a locale's week starts on: Monday for zh-CN and en-GB, Sunday for en-US. */
export function firstDayOfWeek(locale: string): Weekday {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & WeekInfoLocale;
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    // Intl counts Monday as 1 and Sunday as 7.
    if (firstDay !== undefined) return (firstDay % 7) as Weekday;
    const region = info.maximize().region ?? "";
    return SUNDAY_REGIONS.has(region) ? 0 : 1;
  } catch {
    return 1;
  }
}

/** The clock a locale reads: 12 hours for en-US, 24 for zh-CN and en-GB. */
export function hourCycleOf(locale: string): HourCycle {
  const cycle = formatter(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12" ? "h12" : "h23";
}

/**
 * The parts a date is written with, spelled out rather than as a `dateStyle`: a style cannot be
 * joined with a clock's parts, and zh-CN's medium style writes a span as 2026/11/1 – 2026/11/12.
 */
const DATE_PARTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

/** A date the way the locale writes it in a sentence: 2026年11月12日, Nov 12, 2026. */
export function formatDate(date: CalendarDate, locale: string): string {
  return formatter(locale, DATE_PARTS).format(instant(date));
}

/** A day spelled out with its weekday, for a calendar cell's name: Thursday, November 12, 2026. */
export function formatDayName(date: CalendarDate, locale: string): string {
  return formatter(locale, { dateStyle: "full" }).format(instant(date));
}

/** A month grid's title: 2026年11月, November 2026. */
export function formatMonthTitle(month: CalendarMonth, locale: string): string {
  return formatter(locale, { year: "numeric", month: "long" }).format(
    instant({ year: month.year, month: month.month, day: 1 }),
  );
}

/**
 * A clock's parts in a given cycle: two-digit hours on 24 (07:05, which zh-CN and en-GB would
 * otherwise write as 7:05), the locale's own on 12 (7:05 AM, 上午7:05), two-digit minutes.
 */
const clockOptions = (cycle: HourCycle): Intl.DateTimeFormatOptions => ({
  hour: cycle === "h23" ? "2-digit" : "numeric",
  minute: "2-digit",
  hourCycle: cycle,
});

/** A time on the locale's clock face, or the one asked for: 14:30, 2:30 PM. */
export function formatTime(time: ClockTime, locale: string, cycle: HourCycle): string {
  return formatter(locale, clockOptions(cycle)).format(instant(CLOCK_DAY, time));
}

/** A date with its time: 2026年11月12日 14:30, Nov 12, 2026, 2:30 PM. */
export function formatDateTime(
  date: CalendarDate,
  time: ClockTime,
  locale: string,
  cycle: HourCycle,
): string {
  return formatter(locale, { ...DATE_PARTS, ...clockOptions(cycle) }).format(instant(date, time));
}

/**
 * A span of days the way the locale writes one, sharing what the two ends share:
 * 2026年11月1日至12日, Nov 1 – 12, 2026. One day reads as that day.
 *
 * Chinese is joined here: the engines' range format writes every zh-CN span in slashes
 * (2026/11/1 – 2026/11/12), whatever parts it is asked for. An engine without `formatRange` joins
 * the same way, with a dash.
 */
export function formatDateRange(from: CalendarDate, to: CalendarDate, locale: string): string {
  const format = formatter(locale, DATE_PARTS);
  const chinese = locale.toLowerCase().startsWith("zh");
  if (!chinese && typeof format.formatRange === "function") {
    return format.formatRange(instant(from), instant(to));
  }
  return joinedRange(format, from, to, chinese ? "至" : " – ");
}

/**
 * The first end in full, then the second without the year — and the month — it shares with the
 * first, where the locale writes those first: 2026年11月1日至12日, 2026年10月28日至11月3日.
 */
function joinedRange(
  format: Intl.DateTimeFormat,
  from: CalendarDate,
  to: CalendarDate,
  separator: string,
): string {
  const start = format.format(instant(from));
  if (compareDates(from, to) === 0) return start;
  const parts = format.formatToParts(instant(to));
  let at = 0;
  const drop = (type: Intl.DateTimeFormatPartTypes) => {
    if (parts[at]?.type !== type) return;
    at += parts[at + 1]?.type === "literal" ? 2 : 1;
  };
  if (from.year === to.year) {
    drop("year");
    if (from.month === to.month) drop("month");
  }
  return `${start}${separator}${parts
    .slice(at)
    .map((part) => part.value)
    .join("")}`;
}

/** A weekday column's heading, short and in full, in the order the locale's week runs. */
export interface WeekdayName {
  readonly short: string;
  readonly long: string;
}

export function weekdayNames(locale: string, firstDay: Weekday): WeekdayName[] {
  const short = formatter(locale, { weekday: "short" });
  const long = formatter(locale, { weekday: "long" });
  // 4 January 2026 is a Sunday: walking from it gives each weekday by its `getUTCDay` number.
  return Array.from({ length: 7 }, (_, i) => {
    const at = instant({ year: 2026, month: 1, day: 4 + ((firstDay + i) % 7) });
    return { short: short.format(at), long: long.format(at) };
  });
}

/** The twelve months' names for a wheel: 1月 … 12月 in Chinese, January … December in English. */
export function monthNames(locale: string): string[] {
  const numeric = locale.toLowerCase().startsWith("zh");
  const format = formatter(locale, { month: numeric ? "numeric" : "long" });
  return Array.from({ length: 12 }, (_, i) =>
    format.format(instant({ year: 2026, month: i + 1, day: 1 })),
  );
}

/** A year for a wheel: 2026年, 2026. */
export function yearName(year: number, locale: string): string {
  return formatter(locale, { year: "numeric" }).format(instant({ year, month: 1, day: 1 }));
}

/** Whether the locale writes the day period before the hour (下午2:30) rather than after (2:30 PM). */
export function periodFirst(locale: string): boolean {
  const parts = formatter(locale, { hour: "numeric", hourCycle: "h12" })
    .formatToParts(instant(CLOCK_DAY, { hour: 21, minute: 0 }))
    .map((part) => part.type);
  const period = parts.indexOf("dayPeriod");
  return period !== -1 && period < parts.indexOf("hour");
}

/** Whether the locale names a month after its year (2026年11月) rather than before (November 2026). */
export function yearFirst(locale: string): boolean {
  const parts = formatter(locale, { year: "numeric", month: "long" })
    .formatToParts(instant({ year: 2026, month: 11, day: 1 }))
    .map((part) => part.type);
  return parts.indexOf("year") < parts.indexOf("month");
}

/** The two day periods of a 12-hour clock: 上午 / 下午, AM / PM. */
export function dayPeriodNames(locale: string): [string, string] {
  const format = formatter(locale, { hour: "numeric", hourCycle: "h12" });
  const period = (hour: number) =>
    format
      .formatToParts(instant(CLOCK_DAY, { hour, minute: 0 }))
      .find((part) => part.type === "dayPeriod")?.value ?? (hour < 12 ? "AM" : "PM");
  return [period(9), period(21)];
}
