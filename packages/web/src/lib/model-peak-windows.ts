import type { OffPeakDiscount } from "@prismshadow/penguin-core/model-catalog";
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
