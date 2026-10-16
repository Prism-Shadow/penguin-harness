/**
 * The off-peak tier's peak windows as the dictionaries spell them. The type sits in lib/ because
 * both dictionaries take it; the models feature computes it (`peakWindows` in
 * features/models/model-grouping.ts).
 */
import type { OffPeakDiscount } from "@prismshadow/penguin-core/model-catalog";

/**
 * A schedule's peak windows reduced to the parts a sentence about them needs. Each dictionary
 * spells this one digest in its own words, so the explanation follows the schedule a row
 * actually declares; the catalog carries more than one vendor's windows. Both name the zone as
 * Beijing time: every catalog schedule is written in UTC+8, which the catalog's tests pin.
 */
export interface PeakWindows {
  /**
   * The ISO weekdays the windows fall on (1 = Monday … 7 = Sunday), as inclusive runs of
   * consecutive days: `[[1, 5]]` is Monday to Friday.
   */
  days: Array<[number, number]>;
  /** The runs cover the whole week, so the windows recur daily. */
  everyDay: boolean;
  /** The windows on those days, as whole-hour `[start, end)` pairs in Beijing time. */
  hours: OffPeakDiscount["peakHours"];
}
