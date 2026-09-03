/**
 * The human schedule line under a task's name in the chat dock's scheduled-tasks panel: the
 * period folded into everyday words ("Every day at 08:00", "Every Monday at 09:00", "Every
 * 30 minutes"), a one-off task's fire time relative to today, the next trigger of a repeating
 * task, and a settled state named up front ("Expired · Every day at 08:00"). Pure, so the
 * period and relative-day rules are unit-tested (test/schedule-describe.test.ts): the words
 * come from the active dictionary, the dates from the caller's locale, and "today" from the
 * `now` the caller passes.
 */
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatMonthDay } from "../../lib/format";
import type { Locale } from "../../state/locale";

/** The fields the line reads; the rest of ScheduleItem does not change it. */
export type ScheduleLineInput = Pick<ScheduleItem, "status" | "period" | "startAt" | "nextFireAt">;

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** A `30m` / `12h` / `7d` period in minutes — the server's grammar; null for anything else. */
export function periodMinutes(raw: string): number | null {
  const m = /^(\d+)([mhd])$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n * (m[2] === "m" ? 1 : m[2] === "h" ? HOUR : DAY);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local wall-clock `HH:mm`. */
function clockTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * The local calendar date as `yyyy-mm-dd`, the shape formatMonthDay reads: it takes the date
 * part of its input verbatim, so the zone conversion has to happen here, on the Date.
 */
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 周一 / Monday: the short form in Chinese already carries the "week" character the sentence needs. */
function weekdayName(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    weekday: locale === "zh" ? "short" : "long",
  }).format(d);
}

/** Whole local calendar days from `from` to `to` (negative when `to` is earlier). */
function calendarDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** An instant relative to today: "today 10:00", "tomorrow 10:00", else its date — with the year only when it differs from today's. */
export function describeInstant(iso: string, locale: Locale, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const h = S.schedule.human;
  const time = clockTime(d);
  const days = calendarDays(now, d);
  if (days === 0) return h.today(time);
  if (days === 1) return h.tomorrow(time);
  const monthDay = formatMonthDay(localYmd(d), locale);
  return d.getFullYear() === now.getFullYear()
    ? h.onDate(monthDay, time)
    : h.onDateWithYear(d.getFullYear(), monthDay, time);
}

/**
 * The period in everyday words, anchored on one trigger's wall clock (and, for a weekly task,
 * its weekday). The anchor is the NEXT trigger where the server named one, not `start_at`:
 * the server steps from `start_at` in fixed milliseconds, so a daily task fires an hour off
 * its original wall clock once a DST boundary passes, and a line anchored on `start_at` would
 * then contradict the next trigger printed beside it ("Every day at 08:00 · Next: tomorrow
 * 09:00"). A period the grammar does not cover is shown as written.
 */
function describePeriod(period: string, anchor: string, locale: Locale): string {
  const h = S.schedule.human;
  const minutes = periodMinutes(period);
  const start = new Date(anchor);
  if (minutes === null || Number.isNaN(start.getTime())) return period;
  const time = clockTime(start);
  if (minutes === WEEK) return h.everyWeek(weekdayName(start, locale), time);
  if (minutes % DAY === 0)
    return minutes === DAY ? h.everyDay(time) : h.everyDays(minutes / DAY, time);
  if (minutes % HOUR === 0) return h.everyHours(minutes / HOUR);
  return h.everyMinutes(minutes);
}

/**
 * The whole line. An invalid file is named by its status alone (its reason rides the row's
 * tooltip); a settled task leads with its state; an armed repeating task ends with its next
 * trigger — a one-off's next trigger IS its start time, so it is not repeated.
 */
export function describeSchedule(
  item: ScheduleLineInput,
  locale: Locale,
  now: Date = new Date(),
): string {
  const names = S.schedule.statusNames;
  if (item.status === "invalid") return names[item.status] ?? item.status;
  const summary =
    item.period !== undefined
      ? describePeriod(item.period, item.nextFireAt ?? item.startAt, locale)
      : S.schedule.human.once(describeInstant(item.startAt, locale, now));
  if (item.status === "done" || item.status === "expired" || item.status === "missed")
    return `${names[item.status] ?? item.status} · ${summary}`;
  if (item.status === "active" && item.period !== undefined && item.nextFireAt !== undefined)
    return `${summary} · ${S.schedule.human.next(describeInstant(item.nextFireAt, locale, now))}`;
  return summary;
}
