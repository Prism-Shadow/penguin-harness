/**
 * Rota advice for a calendar write. A calendar is a rota, not a broadcast: desks that fire
 * on the same minute compete for the same budget minute and the same tickets, and a second
 * sweep on one employee doubles its cost for nothing. The write itself always succeeds —
 * these are advisory lines the CLI prints and the skills tell employees to act on, so a
 * scheduling mistake is visible at the moment it is made instead of at the month's bill.
 *
 * Pure: the caller passes the organization's whole calendar listing, the event it just
 * wrote, the clock and the organization's timezone.
 */
import { zonedParts } from "../../organization/zoned.js";

/** The fields a rota check reads; `OrgCalendarItem` satisfies it. */
export interface RotaEvent {
  agentId: string;
  name: string;
  enabled: boolean;
  /** ISO 8601 instant, as stored. */
  startAt: string;
  /** Absent for a one-shot event. */
  period?: string;
}

/** How close to the write "started at now" counts as: the CLI resolves `--start-at now` to the current instant. */
const NOW_WINDOW_MS = 90_000;

/** `HH:MM` of an instant in the organization's timezone, or null when `startAt` is not an instant. */
function startMinute(timezone: string, startAt: string): string | null {
  const ms = Date.parse(startAt);
  if (Number.isNaN(ms)) return null;
  const p = zonedParts(timezone, ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

const isRecurring = (e: RotaEvent): boolean => e.period !== undefined && e.period !== "";

const isSame = (a: RotaEvent, b: RotaEvent): boolean =>
  a.agentId === b.agentId && a.name === b.name;

/**
 * The advisory lines for `written`, in the order a scheduler should fix them: whose minute
 * it collides with, whether that employee already sweeps on this cadence, and whether it was
 * started at "now" (which pins every event scheduled that way to one minute). Empty when the
 * rota is clean — a disabled event is nobody's rota.
 */
export function rotaWarnings(
  events: readonly RotaEvent[],
  written: RotaEvent,
  nowMs: number,
  timezone: string,
): string[] {
  if (!written.enabled) return [];
  const out: string[] = [];
  const minute = startMinute(timezone, written.startAt);
  if (minute !== null) {
    for (const e of events) {
      if (isSame(e, written) || e.agentId === written.agentId) continue;
      if (!e.enabled || !isRecurring(e)) continue;
      if (startMinute(timezone, e.startAt) !== minute) continue;
      out.push(
        `\`${e.agentId}/${e.name}\` also fires at ${minute}; give every employee its own minute.`,
      );
    }
  }
  if (isRecurring(written)) {
    for (const e of events) {
      if (isSame(e, written) || e.agentId !== written.agentId) continue;
      if (!e.enabled || e.period !== written.period) continue;
      out.push(
        `\`${written.agentId}\` already has a recurring event \`${e.name}\` with period ${written.period}; one sweep per employee.`,
      );
    }
    const ms = Date.parse(written.startAt);
    if (!Number.isNaN(ms) && Math.abs(ms - nowMs) <= NOW_WINDOW_MS) {
      out.push(
        "A recurring event started at 'now' shares its minute with every other event started the same way; pick the role's hour.",
      );
    }
  }
  return out;
}
