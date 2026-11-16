/**
 * Catalogue entries billed by the clock, and instants on either side of their peak, for the
 * suites that price a row at a moment (model-grouping, model-sort).
 *
 * An entry is chosen by what it can do (an off-peak tier beside a list price), never by name,
 * and every instant is worked out from that entry's own schedule. A vendor moving its hours,
 * changing its rate or leaving the catalogue therefore changes no expectation here: the suites
 * hold the pricing rule, not today's catalogue.
 */
import { MODEL_CATALOG, catalogEntryFor } from "@prismshadow/penguin-server/model-catalog";
import type { ModelCatalogEntry, OffPeakDiscount } from "@prismshadow/penguin-server/model-catalog";

/** An entry with an off-peak tier and the list price it comes off. */
export type ScheduledEntry = ModelCatalogEntry & {
  offPeakDiscount: OffPeakDiscount;
  pricing: NonNullable<ModelCatalogEntry["pricing"]>;
};

/** Every scheduled entry the catalogue holds, each the one its own pair looks up. */
export const SCHEDULED: ScheduledEntry[] = MODEL_CATALOG.filter(
  (e): e is ScheduledEntry =>
    e.offPeakDiscount !== undefined &&
    e.pricing !== undefined &&
    catalogEntryFor(e.provider, e.modelId) === e,
);

/** The first scheduled entry; the suites need one, and fail loudly if the catalogue has none. */
export function scheduledEntry(): ScheduledEntry {
  const entry = SCHEDULED[0];
  if (entry === undefined) throw new Error("the catalogue holds no entry with an off-peak tier");
  return entry;
}

/** The row a Project stores for an entry: its list price (the peak one), no promotion. */
export function listPriceRow(entry: ScheduledEntry) {
  return {
    provider: entry.provider,
    modelId: entry.modelId,
    cacheRead: String(entry.pricing.cache_read),
    cacheWrite: String(entry.pricing.cache_write),
    output: String(entry.pricing.output),
  };
}

const HALF_HOUR_MS = 1_800_000;
/** A Monday at 00:00 UTC, and every half hour of the week from it. */
const MONDAY_UTC = Date.UTC(2026, 7, 31);
const WEEK = Array.from({ length: 7 * 48 }, (_, i) => MONDAY_UTC + i * HALF_HOUR_MS);

/** Whether the schedule bills its list price at instant `t` (ms), read in its own zone. */
function peakAt(schedule: OffPeakDiscount, t: number): boolean {
  const local = new Date(t + schedule.utcOffsetMinutes * 60_000);
  const day = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return (
    schedule.peakDays.includes(day) &&
    schedule.peakHours.some(([from, to]) => hour >= from && hour < to)
  );
}

/** An instant inside the schedule's peak. */
export function peakInstant(schedule: OffPeakDiscount): Date {
  const found = WEEK.find((t) => peakAt(schedule, t));
  if (found === undefined) throw new Error("the schedule has no peak hour");
  return new Date(found);
}

/** An instant outside every peak window. */
export function offPeakInstant(schedule: OffPeakDiscount): Date {
  const found = WEEK.find((t) => !peakAt(schedule, t));
  if (found === undefined) throw new Error("the schedule has no off-peak hour");
  return new Date(found);
}

/** An instant inside `a`'s peak and outside `b`'s, or undefined when no half hour parts them. */
export function peakOfOneOnly(a: OffPeakDiscount, b: OffPeakDiscount): Date | undefined {
  const found = WEEK.find((t) => peakAt(a, t) && !peakAt(b, t));
  return found === undefined ? undefined : new Date(found);
}
