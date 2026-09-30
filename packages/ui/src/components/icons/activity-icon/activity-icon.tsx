/**
 * A conversation's activity marks — a session row's trailing glyphs and the chat header's.
 *
 * `ActivityIcon` draws three states, each legible from its shape and its motion alone, with
 * colour carrying only the severity every reader shares:
 *
 * - **running** — an hourglass, turning over on a loop, the motion a real hourglass makes.
 * - **compacting** — a bar with a chevron closing on it from each side, squeezing on a loop.
 *   Compaction is busy work like any other, so it takes the same attention ink as running; what
 *   it does not share is the shape, because two live states that differ only in colour are two
 *   states a reader has to have been told apart in advance.
 * - **finished, unread** — a small success dot. It is a notification, not a status: "there is a
 *   reply here you have not seen".
 *
 * A read conversation, and one that never ran, draw nothing: the caller renders no icon, so the
 * only marks left in a list are the ones worth acting on. Every glyph names its exact state in
 * its accessible name and tooltip — the caller's `label`, since only the app knows its words — so
 * nothing here is legible only to a sighted reader with full colour vision.
 *
 * Every state renders into the same `size` box, and the dot is centred in it rather than sized
 * to it: the box is the reservation, so a row never shifts as a run starts, finishes and is read.
 *
 * Two further marks sit beside it. `BackgroundTasksMark` is work going on behind the conversation
 * — a background command process, a background subagent, or one call made in the background —
 * in the busy ink, because that work is still running, only outside the turn. `ScheduleMark` is
 * a standing arrangement — a scheduled task that will fire without anyone opening the
 * conversation — in the subtle ink, receding with the row's settled marks, which is allowed
 * only because its label always says it in words.
 *
 * The motion is the `hourglass-turn` and `compact-squeeze` keyframes in the theme foundation:
 * they only rotate or scale, so with animation switched off the glyph stands still and stays
 * fully legible.
 */
import { ICON_SIZE } from "../../../icon-scale";
import { Dot } from "../dot/dot";
import { GlyphIcon } from "../glyph-icon/glyph-icon";
import { ICONS } from "../icons";

export type ActivityIconState = "running" | "compacting" | "completedUnread";

type LiveState = Exclude<ActivityIconState, "completedUnread">;

/** The two live states' drawing and motion; both take the attention ink. */
const LIVE: Record<LiveState, { d: string; motion: string }> = {
  running: { d: ICONS.hourglass, motion: "hourglass-turn" },
  compacting: { d: ICONS.compress, motion: "compact-squeeze" },
};

export function ActivityIcon({
  activity,
  label,
  size = ICON_SIZE.rowMark,
}: {
  activity: ActivityIconState;
  /** The state in words: the accessible name and the tooltip. */
  label: string;
  size?: number;
}) {
  if (activity === "completedUnread") {
    // A plain labelled image: run completion is announced by the app's notification path, so
    // the dot must not announce itself again as a live status.
    return (
      <span
        role="img"
        aria-label={label}
        data-tooltip={label}
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center"
      >
        <Dot tone="success" size="xs" />
      </span>
    );
  }
  const { d, motion } = LIVE[activity];
  return (
    <span
      role="status"
      aria-label={label}
      data-tooltip={label}
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center text-tone-attention-fg"
    >
      <GlyphIcon d={d} size={size} className={motion} />
    </span>
  );
}

/**
 * Work going on behind a conversation: a count of background tasks on a session row and in the
 * chat header, or the one call made with `run_in_background` on a tool row. The label is the only
 * carrier of the state, so it is required, and the size is the rung of the row it sits in.
 * Rendered only when there is background work to report — the caller decides.
 */
export function BackgroundTasksMark({ label, size }: { label: string; size: number }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-tooltip={label}
      className="flex shrink-0 items-center text-tone-success-fg"
    >
      <GlyphIcon d={ICONS.pulse} size={size} />
    </span>
  );
}

/**
 * A standing scheduled task: the conversation will run on its own. Icon only, no count — how many
 * tasks, and when, is the schedules panel's business. The label is the only carrier of the
 * meaning, so it is required.
 */
export function ScheduleMark({ label, size }: { label: string; size: number }) {
  return (
    <span
      role="img"
      aria-label={label}
      data-tooltip={label}
      className="flex shrink-0 items-center text-fg-subtle"
    >
      <GlyphIcon d={ICONS.alarmClock} size={size} />
    </span>
  );
}
