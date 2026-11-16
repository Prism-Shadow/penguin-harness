/**
 * The conversation's run indicator in the chat toolbar, beside the title: a turning hourglass
 * while a turn runs, with the word for it from `sm` up (below that only the glyph remains, so the
 * title keeps its room), and nothing at all otherwise. The conversation on screen is by
 * definition read, so the unread state is the sidebar's affordance for the rows not on screen,
 * and a compaction is told by the stream's own banner rather than repeated here.
 *
 * It carries the `ui-run` hook: the indicator names its state (`data-state="running"`, the one
 * state it is drawn in) and its parts, the `mark` and the `label`, so a theme may set the running
 * state apart its own way. The glyph keeps its own turning in every theme, and the label is the
 * glyph's own accessible name in words, so a theme never makes either the only carrier.
 */
import { ActivityIcon } from "@prismshadow/penguin-ui";
import { sessionActivityLabel } from "../../lib/session-activity";
import type { SessionActivity } from "../../lib/session-activity";

export function RunStatus({ activity }: { activity: SessionActivity }) {
  if (activity !== "running") return null;
  const label = sessionActivityLabel(activity);
  return (
    <span
      data-state="running"
      className="ui-run flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
    >
      <span data-slot="mark" className="flex shrink-0">
        <ActivityIcon activity={activity} label={label} />
      </span>
      <span data-slot="label" className="hidden sm:inline">
        {label}
      </span>
    </span>
  );
}
