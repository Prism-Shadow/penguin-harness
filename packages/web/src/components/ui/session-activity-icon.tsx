import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk } from "../../lib/tone";
import type { SessionActivity } from "../../lib/session-activity";
import { GlyphIcon } from "./glyph-icon";
import { BACKGROUND_TASKS_ICON } from "./icons";

type Activity = Exclude<SessionActivity, null>;

/**
 * Session-level activity glyphs (sidebar rows + chat header).
 *
 * Three states, three marks — each state is legible from its shape and its motion alone, with
 * colour carrying only the severity every reader shares:
 *
 * - **running** — an hourglass, turning over on a loop, the motion a real hourglass makes.
 * - **compacting** — a bar with a chevron closing on it from each side, squeezing on a loop.
 *   Compaction is busy work like any other, so it takes the same `attention` tone as running;
 *   what it does not share is the shape, because two live states that differ only in colour are
 *   two states a reader has to have been told apart in advance.
 * - **finished, unread** — a small green dot. It is a notification, not a status: it says
 *   "there is a reply here you have not seen".
 * - **finished, read** — nothing. The dot is removed rather than muted, so the only marks left
 *   in the list are the ones worth acting on. A Session that has never run renders nothing for
 *   the same reason (see sessionActivity), which makes the two visually identical by design.
 *
 * Every glyph also names its exact state in its accessible name and tooltip, so nothing here is
 * legible only to a sighted user with full colour vision. The read state announces nothing
 * because it renders nothing, which is correct — there is no state to report.
 *
 * Background work is a separate mark, not a fourth state (BackgroundTasksMark below): an
 * activity trace in the `busy` tone, drawn beside whichever glyph the row wears — an idle, read
 * Session can still own a dev server or a background subagent, and the row says both.
 *
 * Ink comes from the shared tone tokens (lib/tone.ts), which carry the measured contrast ratios
 * against the two surfaces these glyphs sit on: the sidebar (gray-50 / gray-900) and the chat
 * header (white / gray-950).
 */
export const ACTIVITY_GLYPH: Record<"running" | "compacting", string> = {
  // Hourglass: frame top and bottom, sand funnelling to the waist.
  running: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",
  // Compress: a centre bar with a chevron bearing down on it from above and up from below.
  compacting: "M4 12h16M8 7l4 3 4-3M8 17l4-3 4 3",
};

/**
 * Ink and motion per live state. Both are `attention` — unfinished work waiting on time — and
 * each pairs its tone with the animation that reads as its own kind of work: the hourglass turns
 * over, the compress mark squeezes. The unread dot takes the `success` dot fill, one tone in
 * both themes, exactly as the Session status dot beside it does (sidebar.tsx's StatusDot and its
 * twin in the chat header). It is the same kind of marker in the same place.
 */
const APPEARANCE: Record<"running" | "compacting", string> = {
  running: `hourglass-turn ${toneInk.attention}`,
  compacting: `compact-squeeze ${toneInk.attention}`,
};

/** Localized status label (read at render time: `S` is a live binding swapped per locale). */
export function sessionActivityLabel(activity: Activity): string {
  if (activity === "running") return S.chat.statusRunning;
  if (activity === "compacting") return S.chat.statusCompacting;
  return S.chat.statusCompletedUnread;
}

/**
 * The background-task mark: "work is going on behind this" wherever the app says so — a
 * session row and the chat header, where it stands for the conversation's whole set of
 * background command processes and subagents, and a tool row, where it marks the one call
 * that was made with `run_in_background`. `busy` ink, because that is what it means.
 *
 * Both props are the caller's to decide, because the two placements genuinely differ: the
 * label names a count in one place and a single call in the other, and the size is the rung
 * the surrounding row already uses (a session row's trailing marks, a tool row's inline
 * glyphs). The label is the only carrier of the state — colour and shape never are — so it
 * is required rather than defaulted. Rendered only when there is background work to report:
 * the caller decides, so no row reserves a box for it.
 */
export function BackgroundTasksMark({ label, size }: { label: string; size: number }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex shrink-0 items-center ${toneInk.busy}`}
    >
      <GlyphIcon d={BACKGROUND_TASKS_ICON} size={size} />
    </span>
  );
}

export function SessionActivityIcon({ activity }: { activity: Activity }) {
  const size = ICON_SIZE.rowMark;
  const label = sessionActivityLabel(activity);
  if (activity === "completedUnread") {
    // The dot itself is exactly the Session status dot's geometry — `h-1.5 w-1.5`, 6px, the same
    // at both surfaces on main. It is centred inside the same `size` box the hourglass occupies
    // rather than sitting in the row's flow directly, which is what keeps a row from shifting as
    // the glyph appears, swaps shape, or goes away entirely. Centring changes where the 6px sits,
    // never how big it is: the box is the reservation, the dot is the mark.
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center"
      >
        <span className={`block h-1.5 w-1.5 rounded-full ${toneDot.success}`} />
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
