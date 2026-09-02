/**
 * The organization calendar's geometry (pure, unit tested in Node): the day grid of a month,
 * the seven days of a week, the visible range of each view, stepping the anchor date, the
 * expansion of each event's `startAt` / `period` / `endAt` into the instances that fall in a
 * range, where an instance sits in a day column and which lane it takes when instances
 * overlap, and the cadence an event's `period` reads as in the legend. Everything is computed
 * on local calendar days through the Date API's local accessors, so a test built with
 * `new Date(y, m, d)` reads the same in every timezone.
 */
import type { OrgCalendarItem, OrgCalendarOutcome } from "@prismshadow/penguin-server/api";
import { packToolLanes } from "../traces/lane-packing";

export type CalendarView = "month" | "week" | "day";

export const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** `yyyy-mm-dd` of a local calendar day. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `n` calendar days after the day containing `ms`, at local midnight (DST-safe: built from calendar parts, not by adding 24h). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Local midnight of the Monday on or before `ms` (the week starts on Monday, as the weekday labels do). */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  // getDay: 0 = Sunday. Monday-based offset: Sunday counts as the sixth day of its week.
  const offset = (d.getDay() + 6) % 7;
  return addDays(d.getTime(), -offset);
}

export interface GridDay {
  key: string;
  dayStartMs: number;
  /** Whether the day belongs to the month on display (leading and trailing days of the grid do not). */
  inMonth: boolean;
}

/**
 * Monday-based rows of seven days covering the month of `anchorMs`: as many rows as the month
 * needs (four to six), so a month never trails a whole row of the next one.
 */
export function monthGrid(anchorMs: number): GridDay[][] {
  const a = new Date(anchorMs);
  const first = new Date(a.getFullYear(), a.getMonth(), 1).getTime();
  const month = a.getMonth();
  const daysInMonth = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  const lead = (new Date(first).getDay() + 6) % 7;
  const rowCount = Math.ceil((lead + daysInMonth) / 7);
  let cursor = startOfWeek(first);
  const rows: GridDay[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: GridDay[] = [];
    for (let c = 0; c < 7; c++) {
      row.push({
        key: dayKey(cursor),
        dayStartMs: cursor,
        inMonth: new Date(cursor).getMonth() === month,
      });
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}

/** The seven days of the week containing `anchorMs`, Monday first. */
export function weekDays(anchorMs: number): GridDay[] {
  const start = startOfWeek(anchorMs);
  return Array.from({ length: 7 }, (_, i) => {
    const dayStartMs = addDays(start, i);
    return { key: dayKey(dayStartMs), dayStartMs, inMonth: true };
  });
}

/** The visible range of a view around its anchor: `[startMs, endMs)`. */
export function viewRange(
  anchorMs: number,
  view: CalendarView,
): { startMs: number; endMs: number } {
  if (view === "day") {
    const startMs = startOfDay(anchorMs);
    return { startMs, endMs: addDays(startMs, 1) };
  }
  if (view === "week") {
    const startMs = startOfWeek(anchorMs);
    return { startMs, endMs: addDays(startMs, 7) };
  }
  const grid = monthGrid(anchorMs);
  const startMs = grid[0]![0]!.dayStartMs;
  return { startMs, endMs: addDays(grid[grid.length - 1]![6]!.dayStartMs, 1) };
}

/** The anchor one step (`delta` of ±1) forward or back in a view: a day, a week, or a calendar month (clamped to the target month's length). */
export function shiftAnchor(anchorMs: number, view: CalendarView, delta: number): number {
  if (view === "day") return addDays(anchorMs, delta);
  if (view === "week") return addDays(anchorMs, 7 * delta);
  const d = new Date(anchorMs);
  const first = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay)).getTime();
}

/** `yyyy-mm` of the month containing `ms` (the month view's heading). */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** A fixed interval in `30m` / `12h` / `7d` form as milliseconds; null when it is not one (the server's parsePeriod rule). */
export function parsePeriodMs(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const m = /^(\d+)([mhd])$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  const unit = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : DAY_MS;
  return n * unit;
}

export interface EventInstance {
  event: OrgCalendarItem;
  atMs: number;
  /** Stable key: `<agentId>/<name>@<atMs>`. */
  key: string;
  /** The instance is in the past against `nowMs`. */
  past: boolean;
  /**
   * What the scheduler did with this instance, when it can be told: only the most recent
   * evaluation is recorded (`lastFiredAt` / `lastOutcome`), so the instance it names carries
   * that outcome and every other past instance carries null — "past", with no claim.
   */
  outcome: OrgCalendarOutcome | null;
}

/** Instances per event within a range: the runaway guard for a tiny period over a long range. */
export const MAX_INSTANCES_PER_EVENT = 400;

/**
 * Every instance of every event inside `[startMs, endMs)`, oldest first. A one-off event
 * (no period) yields at most its `startAt`; a periodic one yields `startAt + k·period` up to
 * its `endAt`. The first k is computed rather than walked so a years-old daily event costs
 * nothing before the range. An unparseable `startAt` or `period` yields nothing — the page
 * lists such events under "invalid" from the server's own verdict.
 */
export function expandEvents(
  events: readonly OrgCalendarItem[],
  startMs: number,
  endMs: number,
  nowMs: number,
): EventInstance[] {
  const out: EventInstance[] = [];
  for (const event of events) {
    const startAt = Date.parse(event.startAt);
    if (!Number.isFinite(startAt)) continue;
    const period = event.period === undefined ? null : parsePeriodMs(event.period);
    if (event.period !== undefined && period === null) continue;
    const endAt = event.endAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(event.endAt);
    const lastFired = event.lastFiredAt === undefined ? null : Date.parse(event.lastFiredAt);
    const push = (atMs: number) => {
      // The recorded evaluation belongs to the instance it is nearest to (within half a period, or a minute for a one-off).
      const tolerance = period === null ? 60_000 : period / 2;
      const isLast =
        lastFired !== null && Number.isFinite(lastFired) && Math.abs(lastFired - atMs) <= tolerance;
      out.push({
        event,
        atMs,
        key: `${event.agentId}/${event.name}@${atMs}`,
        past: atMs <= nowMs,
        outcome: isLast ? (event.lastOutcome ?? null) : null,
      });
    };
    if (period === null) {
      if (startAt >= startMs && startAt < endMs && startAt <= endAt) push(startAt);
      continue;
    }
    let k = startAt < startMs ? Math.ceil((startMs - startAt) / period) : 0;
    let count = 0;
    for (;;) {
      const atMs = startAt + k * period;
      if (atMs >= endMs || atMs > endAt || count >= MAX_INSTANCES_PER_EVENT) break;
      push(atMs);
      k += 1;
      count += 1;
    }
  }
  out.sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  return out;
}

/** Instances bucketed by local day key, each day's list in time order. */
export function instancesByDay(instances: readonly EventInstance[]): Map<string, EventInstance[]> {
  const out = new Map<string, EventInstance[]>();
  for (const i of instances) {
    const key = dayKey(i.atMs);
    const list = out.get(key);
    if (list) list.push(i);
    else out.set(key, [i]);
  }
  return out;
}

/** Where an instant sits in its day, as a fraction of the day (0 = midnight, 0.5 = noon) for the day and week columns. */
export function dayFraction(atMs: number): number {
  const d = new Date(atMs);
  return (d.getHours() * 60 + d.getMinutes()) / (24 * 60);
}

/** `HH:mm` of an instant, local time. */
export function timeLabel(atMs: number): string {
  const d = new Date(atMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The distinct employees of a list of events, in first-appearance order — the colour index each one takes. */
export function employeeOrder(events: ReadonlyArray<{ agentId: string }>): string[] {
  const out: string[] = [];
  for (const e of events) if (!out.includes(e.agentId)) out.push(e.agentId);
  return out;
}

/** Local `datetime-local` input value (`yyyy-mm-ddThh:mm`) of an ISO instant; "" when unparseable or absent. */
export function toLocalInput(iso: string | undefined): string {
  if (iso === undefined) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * How an event recurs, read from `period` and the wall-clock time of `startAt`: the legend
 * says "every day at 09:00" rather than "1d". Whole days become day / week cadences with the
 * time of day; sub-day periods keep their unit; no period is a one-off at its instant.
 */
export type Cadence =
  | { kind: "once"; atMs: number }
  | { kind: "minutes"; n: number }
  | { kind: "hours"; n: number }
  | { kind: "days"; n: number; time: string }
  | { kind: "weeks"; n: number; time: string }
  | { kind: "invalid" };

export function cadenceOf(event: Pick<OrgCalendarItem, "startAt" | "period">): Cadence {
  const startAt = Date.parse(event.startAt);
  if (!Number.isFinite(startAt)) return { kind: "invalid" };
  if (event.period === undefined) return { kind: "once", atMs: startAt };
  const period = parsePeriodMs(event.period);
  if (period === null) return { kind: "invalid" };
  const time = timeLabel(startAt);
  if (period % DAY_MS === 0) {
    const days = period / DAY_MS;
    if (days % 7 === 0) return { kind: "weeks", n: days / 7, time };
    return { kind: "days", n: days, time };
  }
  if (period % 3_600_000 === 0) return { kind: "hours", n: period / 3_600_000 };
  return { kind: "minutes", n: period / 60_000 };
}

/** Where a chip sits among the chips it overlaps: lane `lane` of `lanes` side by side. */
export interface ChipSlot<T> {
  item: T;
  lane: number;
  lanes: number;
}

/**
 * Side-by-side placement for the day and week columns: each instance occupies `slotMs` from
 * its instant, instances whose slots overlap form a cluster, and inside a cluster they pack
 * greedily into lanes (the trace timeline's packer). A chip's width is then `1 / lanes` of
 * its cluster, so a lone 14:00 event stays full width while three 09:00 events share the row.
 */
export function chipLanes<T extends { atMs: number; key: string }>(
  instances: readonly T[],
  slotMs: number,
): ChipSlot<T>[] {
  const sorted = [...instances].sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  const out: ChipSlot<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (cluster.length === 0) return;
    const lanes = packToolLanes(
      cluster.map((item) => ({
        name: "chip",
        startMs: item.atMs,
        endMs: item.atMs + slotMs,
        item,
      })),
    );
    lanes.forEach((lane, i) => {
      for (const span of lane.spans) out.push({ item: span.item, lane: i, lanes: lanes.length });
    });
    cluster = [];
  };
  for (const item of sorted) {
    if (item.atMs >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.atMs + slotMs);
  }
  flush();
  out.sort((a, b) => a.item.atMs - b.item.atMs || a.item.key.localeCompare(b.item.key));
  return out;
}
