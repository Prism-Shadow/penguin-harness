/**
 * Pure helpers the widget renderers share with the text fallback: reading a block's date-times,
 * formatting numbers, temperatures and times in the block's language, and resolving a metric's
 * defaults (kind, gauge, which way is worse, tone, the share a gauge draws). No DOM and no Node,
 * `Intl` only, so the browser, the CLI and the bundled checker print a reading the same way.
 */
import type { A2uiLang, A2uiMetric, A2uiMetricKind, A2uiWeatherCondition } from "./types.js";

const CONDITION_NAMES: Record<A2uiLang, Record<A2uiWeatherCondition, string>> = {
  en: {
    clear: "Clear",
    "partly-cloudy": "Partly cloudy",
    cloudy: "Overcast",
    fog: "Fog",
    drizzle: "Drizzle",
    rain: "Rain",
    "heavy-rain": "Heavy rain",
    thunder: "Thunderstorm",
    snow: "Snow",
    sleet: "Sleet",
    wind: "Windy",
  },
  zh: {
    clear: "晴",
    "partly-cloudy": "多云",
    cloudy: "阴",
    fog: "雾",
    drizzle: "小雨",
    rain: "雨",
    "heavy-rain": "大雨",
    thunder: "雷雨",
    snow: "雪",
    sleet: "雨夹雪",
    wind: "大风",
  },
};

interface Words {
  used: (amount: string) => string;
  remaining: (amount: string) => string;
  today: string;
  days: (n: number) => string;
  hours: (n: number) => string;
  minutes: (n: number) => string;
  seconds: (n: number) => string;
}

const WORDS: Record<A2uiLang, Words> = {
  en: {
    used: (amount) => `${amount} used`,
    remaining: (amount) => `${amount} left`,
    today: "Today",
    days: (n) => `${n} ${n === 1 ? "day" : "days"}`,
    hours: (n) => `${n} ${n === 1 ? "hour" : "hours"}`,
    minutes: (n) => `${n} min`,
    seconds: (n) => `${n} sec`,
  },
  zh: {
    used: (amount) => `已用 ${amount}`,
    remaining: (amount) => `剩余 ${amount}`,
    today: "今天",
    days: (n) => `${n} 天`,
    hours: (n) => `${n} 小时`,
    minutes: (n) => `${n} 分`,
    seconds: (n) => `${n} 秒`,
  },
};

/**
 * ISO 8601 as the catalog accepts it: a date, then optionally `T` and a time to the minute, the
 * second or a fraction, then optionally `Z` or an offset (`+08:00`, `+0800`, `+08`).
 */
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateExists(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Parses an ISO date-time or "YYYY-MM-DD" (local midnight). Null when invalid. Without `Z` or an
 * offset a date-time is the viewer's local time. The date and the time must exist (no 2026-02-30,
 * no 24:00); the parse is by hand so every engine reads the same string the same way.
 */
export function parseA2uiInstant(text: string): Date | null {
  const m = INSTANT.exec(text);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s, fraction, zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!dateExists(year, month, day)) return null;
  if (h === undefined) return new Date(year, month - 1, day);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = fraction === undefined ? 0 : Number(fraction.slice(0, 3).padEnd(3, "0"));
  if (zone === undefined) return new Date(year, month - 1, day, hour, minute, second, ms);
  let offset = 0;
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMinutes = digits.length > 2 ? Number(digits.slice(2)) : 0;
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    offset = (zone.startsWith("-") ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - offset * 60_000);
}

export type A2uiLocale = "zh-CN" | "en-US";

/** The Intl locale of a block language. */
export function localeOf(lang: A2uiLang): A2uiLocale {
  return lang === "zh" ? "zh-CN" : "en-US";
}

/**
 * "1,240", "0.75", "37" — grouping and fraction digits per locale. `decimals` fixes both the
 * minimum and the maximum fraction digits; without it an integer prints none and anything else
 * up to two.
 */
export function formatNumber(value: number, lang: A2uiLang, decimals?: number): string {
  const digits = decimals ?? (Number.isInteger(value) ? 0 : undefined);
  return new Intl.NumberFormat(localeOf(lang), {
    minimumFractionDigits: digits ?? 0,
    maximumFractionDigits: digits ?? 2,
  }).format(value);
}

/** A unit that hugs the number: "37%", "21°C", "5′". */
const TIGHT_UNIT = /^[%°′″]/;

function appendUnit(text: string, unit: string | undefined): string {
  if (unit === undefined || unit === "") return text;
  return TIGHT_UNIT.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

/** `prefix` + number + unit; no space before "%", "°", "′", "″", a space before any other unit. */
export function formatMetricValue(metric: A2uiMetric, lang: A2uiLang): string {
  const number = formatNumber(metric.value, lang, metric.decimals);
  return appendUnit(`${metric.prefix ?? ""}${number}`, metric.unit);
}

/** A metric with the catalog's defaults applied. */
export interface A2uiResolvedMetric {
  kind: A2uiMetricKind;
  gauge: "ring" | "bar" | "none";
  worse: "high" | "low";
  /** "done" (progress complete), "danger", "attention" or undefined. */
  tone?: "done" | "danger" | "attention";
  /**
   * The share the gauge draws, 0–1: (value − min) / (max − min), clamped; undefined without
   * max.
   */
  share?: number;
}

/**
 * The effective kind, gauge, worse and tone of a metric. Gauge: progress draws a bar, anything
 * else with a `max` a ring, without a `max` nothing. Worse: remaining reads low as bad,
 * everything else high. Tone: a complete progress is done; otherwise the thresholds read along
 * `worse` — at or past `danger` is danger, at or past `warn` attention.
 */
export function resolveMetric(metric: A2uiMetric): A2uiResolvedMetric {
  const { value, max, warn, danger } = metric;
  const kind = metric.kind ?? "reading";
  const min = metric.min ?? 0;
  const gauge =
    max === undefined ? "none" : (metric.gauge ?? (kind === "progress" ? "bar" : "ring"));
  const worse = metric.worse ?? (kind === "remaining" ? "low" : "high");
  const resolved: A2uiResolvedMetric = { kind, gauge, worse };
  if (max !== undefined && max > min) {
    resolved.share = Math.min(1, Math.max(0, (value - min) / (max - min)));
  }
  const past = (mark: number | undefined): boolean =>
    mark !== undefined && (worse === "high" ? value >= mark : value <= mark);
  if (kind === "progress" && max !== undefined && value >= max) resolved.tone = "done";
  else if (past(danger)) resolved.tone = "danger";
  else if (past(warn)) resolved.tone = "attention";
  return resolved;
}

/**
 * The default detail line when the model gives none: used "320 / 512 GB used", remaining
 * "1,240 / 5,000 left", progress "7 / 12"; zh 「已用 320 / 512 GB」「剩余 1,240 / 5,000」「7 / 12」.
 * Undefined for a reading or without `max`. A share of 100 % needs no "/ 100%": used and
 * remaining say "37% used" / "40% left", and progress has nothing to add to its figure. A complete
 * progress is not marked here: its tone ("done") carries that, and the renderer and the fallback
 * print the tone.
 */
export function metricDetail(metric: A2uiMetric, lang: A2uiLang): string | undefined {
  const { kind = "reading", max, prefix = "", unit, decimals } = metric;
  if (kind === "reading" || max === undefined) return undefined;
  const value = `${prefix}${formatNumber(metric.value, lang, decimals)}`;
  const percent = unit === "%" && max === 100 && (metric.min ?? 0) === 0;
  if (percent && kind === "progress") return undefined;
  const whole = `${prefix}${formatNumber(max, lang, Number.isInteger(max) ? undefined : decimals)}`;
  const amount = appendUnit(percent ? value : `${value} / ${whole}`, unit);
  if (kind === "progress") return amount;
  return WORDS[lang][kind](amount);
}

/**
 * "+2.4" / "−0.3" with the metric's decimals, prefix and unit ("+0.4 GB", "−¥20"); the minus is
 * U+2212, and a zero change has no sign. Undefined without `delta`.
 */
export function formatDelta(metric: A2uiMetric, lang: A2uiLang): string | undefined {
  const { delta } = metric;
  if (delta === undefined) return undefined;
  const sign = delta > 0 ? "+" : delta < 0 ? "\u2212" : "";
  const number = formatNumber(Math.abs(delta), lang, metric.decimals);
  return appendUnit(`${sign}${metric.prefix ?? ""}${number}`, metric.unit);
}

export interface A2uiCountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** The target is at or before `now`; every count is then 0. */
  reached: boolean;
}

/**
 * Whole days, hours, minutes and seconds left until `target` (all ≥ 0). A part of a second
 * counts as a whole one, so the figure reads 0 only once the target is reached.
 */
export function countdownParts(target: Date, now: Date): A2uiCountdownParts {
  const left = Math.ceil((target.getTime() - now.getTime()) / 1000);
  if (!(left > 0)) return { days: 0, hours: 0, minutes: 0, seconds: 0, reached: true };
  return {
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3_600),
    minutes: Math.floor((left % 3_600) / 60),
    seconds: left % 60,
    reached: false,
  };
}

/**
 * The two largest units left: "3 days 4 hours" / "4 hours 12 min" / "12 min 5 sec" (en);
 * 「3 天 4 小时」「4 小时 12 分」「12 分 5 秒」 (zh). A smaller unit at 0 is left out ("3 days");
 * "" when reached.
 */
export function countdownText(parts: A2uiCountdownParts, lang: A2uiLang): string {
  if (parts.reached) return "";
  const w = WORDS[lang];
  const [first, second]: [string, string] =
    parts.days > 0
      ? [w.days(parts.days), parts.hours > 0 ? w.hours(parts.hours) : ""]
      : parts.hours > 0
        ? [w.hours(parts.hours), parts.minutes > 0 ? w.minutes(parts.minutes) : ""]
        : parts.minutes > 0
          ? [w.minutes(parts.minutes), parts.seconds > 0 ? w.seconds(parts.seconds) : ""]
          : [w.seconds(parts.seconds), ""];
  return second === "" ? first : `${first} ${second}`;
}

/** Weather condition name in the block's language. */
export function conditionName(condition: A2uiWeatherCondition, lang: A2uiLang): string {
  return CONDITION_NAMES[lang][condition];
}

/** "18°", "18°C", "64°F" — degree sign tight to the number; `withUnit` appends the letter. */
export function formatTemp(
  value: number,
  unit: "C" | "F" | undefined,
  withUnit: boolean,
  lang: A2uiLang,
): string {
  return `${formatNumber(value, lang)}°${withUnit ? (unit ?? "C") : ""}`;
}

/** The calendar fields of an instant in a zone, zero-padded ("2026", "10", "04", "14", "05"). */
export function zonedParts(
  date: Date,
  timeZone?: string,
): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

/**
 * HH:mm of an ISO date-time in `timeZone` (default: the runtime's), prefixed with "MM-DD " when
 * its date differs from `now`'s and with "YYYY-MM-DD " when its year does. The same digits in
 * both languages; an unparsable value comes back as written.
 */
export function formatAsOf(asOf: string, lang: A2uiLang, now: Date, timeZone?: string): string {
  const instant = parseA2uiInstant(asOf);
  if (instant === null) return asOf;
  const at = zonedParts(instant, timeZone);
  const today = zonedParts(now, timeZone);
  const time = `${at.hour}:${at.minute}`;
  if (at.year !== today.year) return `${at.year}-${at.month}-${at.day} ${time}`;
  if (at.month !== today.month || at.day !== today.day) return `${at.month}-${at.day} ${time}`;
  return time;
}

/**
 * Short weekday ("Tue" / "周二") of a "YYYY-MM-DD" date (or the date of an ISO date-time),
 * computed in UTC so the date never shifts. "Today" / 「今天」 when it equals `today`
 * ("YYYY-MM-DD"). An unparsable value comes back as written.
 */
export function weekdayOf(date: string, lang: A2uiLang, today?: string): string {
  const day = date.slice(0, 10);
  if (today !== undefined && day === today.slice(0, 10)) return WORDS[lang].today;
  const m = DATE.exec(day);
  if (m === null) return date;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: "short", timeZone: "UTC" }).format(utc);
}
