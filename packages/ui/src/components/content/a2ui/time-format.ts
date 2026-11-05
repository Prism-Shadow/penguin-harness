/**
 * The clock-face arithmetic the live widgets share: the time in a zone as a clock shows it (its
 * digits, day period, weekday and date, and how far the zone runs from the reader's own), an
 * hourly forecast's hour label, and the reader's local calendar day and minute. Pure, `Intl`
 * only; the instant is always passed in, so a test pins it.
 *
 * A zone is an IANA name or `"local"`, the reader's own. Whether a clock reads 12 or 24 hours is
 * the block's call, or with `"auto"` the locale's: en-US reads 12, zh-CN 24.
 */
import { localeOf, parseA2uiInstant } from "@prismshadow/penguin-core/a2ui";
import type { A2uiLang } from "@prismshadow/penguin-core/a2ui";

export type HourCycle = "12" | "24" | "auto";

/** What a clock shows for one zone at one instant. */
export interface TimeParts {
  /** "14:05", "2:05", "14:05:09": the digits, without the day period. */
  time: string;
  /** "AM" / "PM", or the Chinese morning and afternoon words, on a 12-hour clock only. */
  dayPeriod?: string;
  /** The short weekday in the zone, in the block's language: "Sun". */
  weekday: string;
  /** The month and day in the zone, in the block's language: "Oct 4". */
  date: string;
  /** The instant, for `<time dateTime>`. */
  iso: string;
  /** The zone's UTC offset minus the reader's, in hours (fractional for a half-hour zone). */
  offsetHours: number;
  /** The zone's wall-clock fields, for a dial's hands. */
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale and options: building them is the slow part of a tick. */
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = FORMATTERS.get(key);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(locale, options);
    FORMATTERS.set(key, found);
  }
  return found;
}

const timeZoneOf = (zone: string): string | undefined => (zone === "local" ? undefined : zone);

const pad = (n: number): string => String(n).padStart(2, "0");

/** Whether a clock in this language reads 12 hours. */
export function twelveHour(hourCycle: HourCycle, lang: A2uiLang): boolean {
  if (hourCycle !== "auto") return hourCycle === "12";
  const cycle = formatter(localeOf(lang), { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
}

/** The wall-clock fields of an instant in a zone (the runtime's own when undefined). */
function wallClock(at: number, timeZone: string | undefined) {
  const parts = formatter("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    // Some engines write midnight as 24 even under h23.
    hour: field("hour") % 24,
    minute: field("minute"),
    second: field("second"),
  };
}

/** The day period's word for an hour of the day, as the locale writes it on a 12-hour clock. */
function dayPeriodOf(hour: number, lang: A2uiLang): string {
  const parts = formatter(localeOf(lang), {
    hour: "numeric",
    hourCycle: "h12",
    timeZone: "UTC",
  }).formatToParts(Date.UTC(2000, 0, 1, hour));
  return parts.find((part) => part.type === "dayPeriod")?.value ?? (hour < 12 ? "AM" : "PM");
}

/** The time in `zone` at `now` (ms), as a clock in `lang` shows it. */
export function timeParts(
  now: number,
  zone: string,
  hourCycle: HourCycle,
  lang: A2uiLang,
  seconds: boolean,
): TimeParts {
  const locale = localeOf(lang);
  const timeZone = timeZoneOf(zone);
  const at = Math.floor(now / 1000) * 1000;
  const wall = wallClock(at, timeZone);
  const twelve = twelveHour(hourCycle, lang);
  const hourText = twelve ? String(wall.hour % 12 === 0 ? 12 : wall.hour % 12) : pad(wall.hour);
  const time = `${hourText}:${pad(wall.minute)}${seconds ? `:${pad(wall.second)}` : ""}`;
  // The zone's offset is how far its wall clock runs from UTC at this instant; the reader's comes
  // from the runtime, so a "local" zone is 0 by construction.
  const zoneOffset =
    (Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - at) /
    3_600_000;
  const localOffset = -new Date(at).getTimezoneOffset() / 60;
  // `|| 0` folds a negative zero into 0.
  const offsetHours =
    zone === "local" ? 0 : Math.round((zoneOffset - localOffset) * 100) / 100 || 0;
  return {
    time,
    ...(twelve ? { dayPeriod: dayPeriodOf(wall.hour, lang) } : {}),
    weekday: formatter(locale, { timeZone, weekday: "short" }).format(at),
    date: formatter(locale, { timeZone, month: "short", day: "numeric" }).format(at),
    iso: new Date(at).toISOString(),
    offsetHours,
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
  };
}

/** "+7 h", "−3.5 h" (the minus is U+2212); empty at 0. */
export function offsetLabel(hours: number): string {
  if (hours === 0) return "";
  const sign = hours > 0 ? "+" : "−";
  return `${sign}${Math.abs(hours)} h`;
}

/** An IANA zone's city as a fallback label: "America/New_York" → "New York". */
export function zoneCity(zone: string): string {
  const last = zone.slice(zone.lastIndexOf("/") + 1);
  return last.replace(/_/g, " ");
}

/**
 * An hourly forecast entry's label, "HH:mm": the entry as written when it is already a clock time,
 * else its instant in the reader's zone. An unparsable value comes back as written.
 */
export function hourLabel(time: string): string {
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return time;
  const instant = parseA2uiInstant(time);
  if (instant === null) return time;
  const wall = wallClock(instant.getTime(), undefined);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** The reader's calendar day of an instant, "YYYY-MM-DD". */
export function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The reader's date and minute of an instant, "YYYY-MM-DD HH:mm". */
export function localMinute(at: number): string {
  const date = new Date(at);
  return `${localDay(at)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
