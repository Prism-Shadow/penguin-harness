/**
 * Goal-mode banners.
 *
 * - `GoalRoundBanner`: the per-round `[goal]`-prefixed input rendered as a REGULAR user
 *   message bubble (the system re-sends the user's request each round, so each round reads
 *   like any other message the user sent) with a "Goal · round N" notice tucked beneath
 *   it; the Trace page shows the raw block. A round with an empty body falls back to the
 *   one-line notice alone.
 * - `GoalStatusBanner`: the live goal card above the composer — objective excerpt, round
 *   count, token usage against the budget, and the terminal state once the run ends. The
 *   stop control is the regular abort (one signal spans the whole goal loop server-side).
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { humanizeTokens } from "../../lib/format";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { GOAL_ICON, UNLIMITED_BUDGET } from "./goal-use";
import type { GoalBannerState } from "./goal-use";

/** Image glyph (24×24 line path) for the collapsed attachment chip on later goal rounds. */
const ATTACHMENT_ICON = "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0";

/**
 * The objective's attachments under a round bubble: full thumbnails on round 1 (and once
 * expanded), a one-line chip on later rounds. Renders nothing when there are none.
 */
function GoalRoundImages({
  images,
  showFull,
  onExpand,
}: {
  images: string[];
  showFull: boolean;
  onExpand: () => void;
}) {
  if (images.length === 0) return null;
  if (showFull) {
    return (
      <div className="mt-1.5 flex max-w-[88%] flex-wrap justify-end gap-1.5 md:max-w-[75%]">
        {images.map((src, i) => (
          <ZoomableImage
            key={i}
            src={src}
            alt={S.chat.imageAlt}
            className="max-h-40 max-w-full rounded-md"
          />
        ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onExpand}
      className="mt-1.5 flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
    >
      <GlyphIcon d={ATTACHMENT_ICON} size={12} className="shrink-0" />
      {S.chat.goalRoundImages(images.length)}
    </button>
  );
}

export function GoalRoundBanner({
  round,
  objective,
  images = [],
}: {
  round: number;
  objective?: string;
  /** Images attached to the objective, restored from its `[attached image: …]` path lines. */
  images?: string[];
}) {
  // The objective's images are part of EVERY round's input (the path lines ride the re-injected
  // text), so hiding them after round 1 would misrepresent what the model was sent. Showing
  // them full-size every round would bury a 20-round goal under the same picture, so later
  // rounds collapse to a chip that expands on click — honest and quiet at the same time.
  const [expanded, setExpanded] = useState(false);
  const showFull = images.length > 0 && (round === 1 || expanded);
  // A regular right-aligned user bubble (same classes as message-item's user_text
  // rendering), with the round notice under the bubble.
  if (objective !== undefined && objective !== "") {
    return (
      <div className="anim-msg my-4 flex flex-col items-end">
        <div className="max-w-[88%] rounded-lg bg-gray-100 px-4 py-2.5 md:max-w-[75%] dark:bg-gray-800">
          <p className="wrap-anywhere whitespace-pre-wrap text-base leading-relaxed text-gray-900 dark:text-gray-100">
            {objective}
          </p>
        </div>
        <GoalRoundImages images={images} showFull={showFull} onExpand={() => setExpanded(true)} />
        <p className="mt-1 flex items-center gap-1.5 px-0.5 text-xs text-gray-400 dark:text-gray-500">
          <GlyphIcon d={GOAL_ICON} size={12} className="shrink-0" />
          {S.chat.goalRoundBanner(round)}
        </p>
      </div>
    );
  }
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={GOAL_ICON} className="text-gray-400 dark:text-gray-500" />
      {S.chat.goalRoundBanner(round)}
    </p>
  );
}

export function GoalStatusBanner({ goal }: { goal: GoalBannerState }) {
  const tokens =
    goal.budget > 0 && goal.budget !== UNLIMITED_BUDGET
      ? `${humanizeTokens(goal.used)}/${humanizeTokens(goal.budget)}`
      : humanizeTokens(goal.used);
  const finished = goal.status !== "active";
  return (
    <div className="anim-fade mb-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={GOAL_ICON} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span className="min-w-0 flex-1 truncate" title={goal.objective}>
        {goal.objective}
      </span>
      <span className="shrink-0 text-gray-400 dark:text-gray-500">
        {S.chat.goalProgress(goal.rounds, tokens)}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 ${
          finished
            ? goal.status === "complete"
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
            : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        }`}
      >
        {S.chat.goalStatus[goal.status]}
      </span>
    </div>
  );
}
