/**
 * Timezone arithmetic for organizations: budget periods are natural months and chat files
 * are split by day **in the organization's timezone**, while every stored instant stays
 * UTC. Intl is the only clock-zone source Node ships with, so the conversions go through
 * `formatToParts` rather than a bundled zone table.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of an instant in a zone. */
export function zonedParts(timeZone: string, ms: number): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines print "24" for midnight under h23; normalize.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** `yyyy-mm-dd` of an instant in a zone. */
export function zonedDate(timeZone: string, ms: number): string {
  const p = zonedParts(timeZone, ms);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** The zone's UTC offset in minutes at an instant (positive east of UTC). */
export function zonedOffsetMinutes(timeZone: string, ms: number): number {
  const p = zonedParts(timeZone, ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant of a zone's local wall-clock time (a second pass corrects for a DST edge). */
export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zonedOffsetMinutes(timeZone, guess) * 60_000;
  return guess - zonedOffsetMinutes(timeZone, first) * 60_000;
}

export interface ZonedMonthRange {
  /** `yyyy-mm`. */
  period: string;
  /** First instant of the month (inclusive), epoch ms. */
  fromMs: number;
  /** First instant of the next month (exclusive), epoch ms. */
  toMs: number;
}

/** The natural month containing `ms` in a zone; `period` names it, the bounds are UTC instants. */
export function zonedMonthRange(timeZone: string, ms: number): ZonedMonthRange {
  const p = zonedParts(timeZone, ms);
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  return {
    period: `${pad(p.year, 4)}-${pad(p.month)}`,
    fromMs: zonedLocalToUtc(timeZone, p.year, p.month, 1),
    toMs: zonedLocalToUtc(timeZone, nextYear, nextMonth, 1),
  };
}

/** The range for an explicit `yyyy-mm` period; null when the period is malformed. */
export function zonedPeriodRange(timeZone: string, period: string): ZonedMonthRange | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    period,
    fromMs: zonedLocalToUtc(timeZone, year, month, 1),
    toMs: zonedLocalToUtc(timeZone, nextYear, nextMonth, 1),
  };
}

/** The day `[from, to)` range of a `yyyy-mm-dd` in a zone. */
export function zonedDayRange(timeZone: string, date: string): { fromMs: number; toMs: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return {
    fromMs: zonedLocalToUtc(timeZone, y, m, d),
    toMs: zonedLocalToUtc(timeZone, y, m, d + 1),
  };
}
