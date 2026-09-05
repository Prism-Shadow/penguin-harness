/**
 * Pure state of the chat dock's scheduled-tasks panel: which of an agent's tasks belong to
 * the conversation on screen, how the filter chips bucket the server's display statuses,
 * what the search box matches, and which state glyph a row wears. Kept apart from the panel
 * so the rules run in the node-only unit tests (test/schedule-panel-state.test.ts).
 */
import type { ScheduleItem, ScheduleStatus } from "@prismshadow/penguin-server/api";

export type ScheduleFilter = "all" | "active" | "paused" | "completed";

export const SCHEDULE_FILTERS: readonly ScheduleFilter[] = ["all", "active", "paused", "completed"];

/**
 * The chip a status sits under. `disabled` is "paused" — the switch on the row resumes it —
 * and every settled state is "completed". An invalid file fits no chip: it shows under "all"
 * only, with its reason on the row.
 */
export function filterBucket(status: ScheduleStatus): Exclude<ScheduleFilter, "all"> | null {
  switch (status) {
    case "active":
      return "active";
    case "disabled":
      return "paused";
    case "done":
    case "expired":
    case "missed":
      return "completed";
    case "invalid":
      return null;
  }
}

/** The tasks bound to one Session. New-Session tasks belong to the agent as a whole and stay on its settings tab. */
export function sessionSchedules(
  items: readonly ScheduleItem[],
  sessionId: string,
): ScheduleItem[] {
  return items.filter((item) => item.sessionId === sessionId);
}

/** Case-insensitive match on the task's name and its prompt; a blank query matches everything. */
export function matchesQuery(item: Pick<ScheduleItem, "name" | "prompt">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return item.name.toLowerCase().includes(q) || item.prompt.toLowerCase().includes(q);
}

export function filterSchedules(
  items: readonly ScheduleItem[],
  filter: ScheduleFilter,
  query: string,
): ScheduleItem[] {
  return items.filter(
    (item) =>
      (filter === "all" || filterBucket(item.status) === filter) && matchesQuery(item, query),
  );
}

export type ScheduleGlyph = "play" | "pause" | "check" | "alert";

/** The row's state mark: play for an armed task, pause for a disabled one, a check for every settled state, an alert for an invalid file. */
export function scheduleGlyph(status: ScheduleStatus): ScheduleGlyph {
  switch (status) {
    case "active":
      return "play";
    case "disabled":
      return "pause";
    case "done":
    case "expired":
    case "missed":
      return "check";
    case "invalid":
      return "alert";
  }
}
