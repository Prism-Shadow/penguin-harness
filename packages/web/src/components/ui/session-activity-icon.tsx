import { S } from "../../lib/strings";
import type { SessionActivity } from "../../lib/session-activity";

type Activity = Exclude<SessionActivity, null>;

/**
 * Session-level activity glyphs (sidebar rows + chat header).
 *
 * Three states, two shapes:
 *
 * - **busy** — an hourglass, turning over on a loop, the motion a real hourglass makes.
 *   Compaction is busy work like any other, so it reuses the hourglass rather than owning a
 *   third shape; it keeps the amber tone compaction already carries elsewhere in the app (the
 *   stream's compaction banner), so the two live states differ by colour alone.
 * - **finished, unread** — a small green dot. It is a notification, not a status: it says
 *   "there is a reply here you have not seen".
 * - **finished, read** — nothing. The dot is removed rather than muted, so the only marks left
 *   in the list are the ones worth acting on. A Session that has never run renders nothing for
 *   the same reason (see sessionActivity), which makes the two visually identical by design.
 *
 * The colour-only split between the live states is a deliberate exception, not the house style:
 * each glyph names its exact state in its accessible name and tooltip, so nothing here is
 * legible only to a sighted user with full colour vision. The read state announces nothing
 * because it renders nothing, which is correct — there is no state to report.
 */
export const ACTIVITY_GLYPH: Record<"running" | "compacting", string> = {
  // Hourglass: frame top and bottom, sand funnelling to the waist.
  running: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  compacting: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
};

/**
 * Ink per state. Contrast measured against the surfaces these glyphs actually sit on — white
 * and gray-950 — as WCAG 2.x ratios; the 3:1 bar for non-text graphics (1.4.11) is what these
 * are held to:
 *
 * - running    gray-500 / gray-400 …… 4.83 : 1 light, 7.93 : 1 dark
 * - compacting amber-600 / amber-400 … 3.19 : 1 light, 12.06 : 1 dark
 * - unread dot emerald-600 / emerald-400 … 3.77 : 1 light, 10.37 : 1 dark
 *
 * The dot is a shade darker in light mode than the emerald-500 it was originally drawn in:
 * as the only marker left in the list it has to clear 3:1 on white, and emerald-500 reaches
 * just 2.57:1 there. Dark mode keeps the brighter emerald-400 for the same reason in reverse.
 */
const APPEARANCE: Record<"running" | "compacting", string> = {
  running: "hourglass-turn text-gray-500 dark:text-gray-400",
  compacting: "hourglass-turn text-amber-600 dark:text-amber-400",
};

/** Localized status label (read at render time: `S` is a live binding swapped per locale). */
export function sessionActivityLabel(activity: Activity): string {
  if (activity === "running") return S.chat.statusRunning;
  if (activity === "compacting") return S.chat.statusCompacting;
  return S.chat.statusCompletedUnread;
}

export function SessionActivityIcon({
  activity,
  size = 12,
}: {
  activity: Activity;
  size?: number;
}) {
  const label = sessionActivityLabel(activity);
  if (activity === "completedUnread") {
    // The dot sits inside the same `size` box the hourglass occupies, so a row does not shift
    // as the glyph appears, changes shape, or goes away entirely.
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center"
      >
        <span className="block h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
      </span>
    );
  }
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
      // Live states announce as a status; the unread dot is a plain labelled image (run
      // completion is already announced by the notification path, not this glyph).
      role="status"
      aria-label={label}
      className={`block shrink-0 ${APPEARANCE[activity]}`}
    >
      {/* The svg <title> child doubles as the hover tooltip (svg has no HTML title attribute). */}
      <title>{label}</title>
      <path d={ACTIVITY_GLYPH[activity]} />
    </svg>
  );
}
