/**
 * The Project-wide schedules page's own vocabulary: which TYPE a task is, and how the type and
 * status filters bucket a list. Pure, so the rules run in the node-only unit tests
 * (test/schedule-category.test.ts).
 *
 * Status is the server's own display status, bucketed exactly as the chat dock's panel buckets
 * it (schedule-panel-state.ts) — one vocabulary for both surfaces, so a task that reads
 * "生效中" in the dock reads the same in the page's filter.
 *
 * Type is derived here rather than sent by the server: the server stores a raw interval
 * (`30m` / `12h` / `7d`) or nothing at all, and a reader looking for "the daily ones" should
 * not have to translate that grammar in their head. The buckets mirror describePeriod's own
 * wording, so a task filed under "每周" is one whose plan column reads "Every Monday at 09:00".
 */
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import { periodMinutes } from "./schedule-describe";
import { filterBucket } from "./schedule-panel-state";
import type { ScheduleFilter } from "./schedule-panel-state";

export type ScheduleType = "once" | "minutes" | "hours" | "days" | "weeks" | "custom";

/** Every type, in the order the filter chips draw them: no interval first, then coarse to fine. */
export const SCHEDULE_TYPES: readonly ScheduleType[] = [
  "once",
  "minutes",
  "hours",
  "days",
  "weeks",
  "custom",
];

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * The type of one task: a task with no interval is a one-off; a task whose interval the server's
 * grammar does not cover (`m`/`h`/`d`) is `custom` — it shows as written in the plan column, and
 * a reader looking for it should still find it. The weekly bucket is the exact week, like
 * describePeriod: `14d` reads as "every 14 days", so it files under days.
 */
export function scheduleType(period: string | undefined): ScheduleType {
  if (period === undefined) return "once";
  const minutes = periodMinutes(period);
  if (minutes === null) return "custom";
  if (minutes === WEEK) return "weeks";
  if (minutes % DAY === 0) return "days";
  if (minutes % HOUR === 0) return "hours";
  return "minutes";
}

/** How many tasks sit under each status chip; `all` counts every task, invalid files included. */
export function countByStatus(items: readonly Pick<ScheduleItem, "status">[]): Record<ScheduleFilter, number> {
  const counts: Record<ScheduleFilter, number> = { all: items.length, active: 0, paused: 0, completed: 0 };
  for (const item of items) {
    const bucket = filterBucket(item.status);
    if (bucket !== null) counts[bucket] += 1;
  }
  return counts;
}

/** How many tasks sit under each type chip. */
export function countByType(items: readonly Pick<ScheduleItem, "period">[]): Record<ScheduleType, number> {
  const counts: Record<ScheduleType, number> = {
    once: 0,
    minutes: 0,
    hours: 0,
    days: 0,
    weeks: 0,
    custom: 0,
  };
  for (const item of items) counts[scheduleType(item.period)] += 1;
  return counts;
}

/**
 * The list under both filters: a status chip, a type chip ("all" passes everything), and the
 * search box. Generic in the item for the same reason filterSchedules is — the Project-wide
 * list carries the agent that owns each task, and narrowing must not strip it.
 */
export function filterSchedulePage<T extends Pick<ScheduleItem, "status" | "period" | "name" | "prompt">>(
  items: readonly T[],
  status: ScheduleFilter,
  type: ScheduleType | "all",
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (status === "all" || filterBucket(item.status) === status) &&
      (type === "all" || scheduleType(item.period) === type) &&
      (q === "" || item.name.toLowerCase().includes(q) || item.prompt.toLowerCase().includes(q)),
  );
}
