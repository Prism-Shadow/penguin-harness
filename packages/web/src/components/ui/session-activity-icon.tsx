import { S } from "../../lib/strings";
import type { SessionActivity } from "../../lib/session-activity";

/**
 * Session-level activity glyphs (sidebar rows + chat header). The SHAPE carries the state —
 * an hourglass while a run is in progress, two chevrons collapsing inward while history is
 * being compacted, a checkmark in a circle once an observed run completed — so the states
 * stay distinguishable without color vision; the tones below are only a secondary cue.
 * The hourglass and circled check deliberately reuse step-level StatusIcon's shapes: one
 * glyph vocabulary app-wide ("time is being spent" / "finished fine"), with session-specific
 * tones — neutral while work is happening, color reserved for the settled outcome.
 */
export const ACTIVITY_GLYPH: Record<Exclude<SessionActivity, null>, string> = {
  // Hourglass (run in progress)
  running: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  // Two chevrons collapsing toward the middle (context being compacted)
  compacting: "M7 20l5-5 5 5M7 4l5 5 5-5",
  // Checkmark inside a circle (run completed since last opened)
  completed: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-9.2 2.4 2.5 4.6-4.8",
};

/** Ink per state; running adds a slow pulse — motion says "still working", without color. */
const APPEARANCE: Record<Exclude<SessionActivity, null>, string> = {
  running: "animate-pulse text-gray-500 dark:text-gray-400",
  compacting: "text-amber-500 dark:text-amber-400",
  completed: "text-emerald-500 dark:text-emerald-400",
};

/** Localized status label (read at render time: `S` is a live binding swapped per locale). */
export function sessionActivityLabel(activity: Exclude<SessionActivity, null>): string {
  if (activity === "running") return S.chat.statusRunning;
  if (activity === "compacting") return S.chat.statusCompacting;
  return S.chat.statusCompleted;
}

export function SessionActivityIcon({
  activity,
  size = 12,
}: {
  activity: Exclude<SessionActivity, null>;
  size?: number;
}) {
  const label = sessionActivityLabel(activity);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Live states announce as a status; the settled checkmark is a plain labelled image
      // (run completion is already announced by the notification path, not this glyph).
      role={activity === "completed" ? "img" : "status"}
      aria-label={label}
      className={`block shrink-0 ${APPEARANCE[activity]}`}
    >
      {/* The svg <title> child doubles as the hover tooltip (svg has no HTML title attribute). */}
      <title>{label}</title>
      <path d={ACTIVITY_GLYPH[activity]} />
    </svg>
  );
}
