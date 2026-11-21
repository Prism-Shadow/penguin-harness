/** The display status a registered task shows (see {@link scheduleStatus}); the routes and
 * the scheduler both derive it, so the rule lives once, here. */
import type { ScheduleStatus } from "./schedules.js";
import type { ScheduleDefinition } from "./schedule-file.js";
import type { ScheduleStateRow } from "./repos/schedules.js";

/**
 * Displayed status precedence: invalid > done/missed (one-shot) > expired > enabled flag.
 * (Was runtime/scheduler.ts's; the routes read it per row, so it lives beside the routes.)
 */
export function scheduleStatus(
  def: ScheduleDefinition,
  state: ScheduleStateRow,
  nowMs: number,
): ScheduleStatus {
  if (state.invalidReason !== null) return "invalid";
  if (def.periodMs === undefined && state.firedOnce) return "done";
  if (def.periodMs === undefined && state.missed) return "missed";
  if (def.endAtMs !== undefined && nowMs > def.endAtMs) return "expired";
  return def.enabled ? "active" : "disabled";
}

/** Settled = can never fire again without a file edit (done / missed / expired): the statuses the scheduler archives. */
export function isSettledStatus(status: ScheduleStatus): boolean {
  return status === "done" || status === "missed" || status === "expired";
}
