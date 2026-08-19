import { S } from "../../lib/strings";
import type { SessionActivity } from "../../lib/session-activity";

type Activity = Exclude<SessionActivity, null>;

/**
 * Session-level activity glyphs (sidebar rows + chat header).
 *
 * Two shapes only: an hourglass while the Session is busy — turning over on a loop, the motion
 * a real hourglass makes — and a circled checkmark once it has settled. Compaction is busy work
 * like any other, so it reuses the hourglass rather than owning a third shape; it keeps the
 * amber tone compaction already has elsewhere in the app (the stream's compaction banner), so
 * the two live states differ by colour only. The completed check differs by colour only too:
 * vivid while the latest reply is unread, muted once seen.
 *
 * Colour-only distinctions are a deliberate exception, not the house style — each glyph names
 * its exact state in its accessible name and tooltip, so nothing here is legible only to a
 * sighted user with full colour vision. The two tone pairs are also separated in LIGHTNESS, not
 * just hue, so they survive colour-blind vision (see APPEARANCE).
 */
export const ACTIVITY_GLYPH: Record<Activity, string> = {
  // Hourglass: frame top and bottom, sand funnelling to the waist.
  running: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  compacting: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  // Checkmark inside a circle.
  completed: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-9.2 2.4 2.5 4.6-4.8",
  completedUnread: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-9.2 2.4 2.5 4.6-4.8",
};

/**
 * Ink per state. Contrast measured against the surfaces these glyphs actually sit on — white
 * and gray-950 — as WCAG 2.x ratios:
 *
 * - running    gray-500 / gray-400 …… 4.83 : 1 light, 7.93 : 1 dark
 * - compacting amber-600 / amber-400 … 3.19 : 1 light, 12.06 : 1 dark
 * - unread     emerald-700 / emerald-400 … 5.48 : 1 light, 10.47 : 1 dark
 * - completed  gray-400 / gray-600 …… 2.54 : 1 light, 2.66 : 1 dark (recessive on purpose:
 *   "seen, nothing to do", and the state is still in the accessible name)
 *
 * Read vs unread — the one place colour carries the whole distinction — separates by 2.16 : 1
 * in light and 3.93 : 1 in dark, and still by 2.35 : 1 / 3.55 : 1 under simulated deuteranopia,
 * because the pair differs in lightness and not only in hue.
 */
const APPEARANCE: Record<Activity, string> = {
  running: "hourglass-turn text-gray-500 dark:text-gray-400",
  compacting: "hourglass-turn text-amber-600 dark:text-amber-400",
  completed: "text-gray-400 dark:text-gray-600",
  completedUnread: "text-emerald-700 dark:text-emerald-400",
};

/** Localized status label (read at render time: `S` is a live binding swapped per locale). */
export function sessionActivityLabel(activity: Activity): string {
  if (activity === "running") return S.chat.statusRunning;
  if (activity === "compacting") return S.chat.statusCompacting;
  if (activity === "completedUnread") return S.chat.statusCompletedUnread;
  return S.chat.statusCompleted;
}

export function SessionActivityIcon({
  activity,
  size = 12,
}: {
  activity: Activity;
  size?: number;
}) {
  const label = sessionActivityLabel(activity);
  const live = activity === "running" || activity === "compacting";
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
      // Live states announce as a status; a settled Session is a plain labelled image (run
      // completion is already announced by the notification path, not this glyph).
      role={live ? "status" : "img"}
      aria-label={label}
      className={`block shrink-0 ${APPEARANCE[activity]}`}
    >
      {/* The svg <title> child doubles as the hover tooltip (svg has no HTML title attribute). */}
      <title>{label}</title>
      <path d={ACTIVITY_GLYPH[activity]} />
    </svg>
  );
}
