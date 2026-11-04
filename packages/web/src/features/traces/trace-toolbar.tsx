/**
 * The Trace panel's one row of chrome, stuck to the top of the panel's scroll box: the file (a
 * picker or a label) at the start, then the rounds button that opens the navigator, then the
 * export icon. Sticky so the navigator is one click away at any scroll position — a long Trace's
 * reader is always somewhere in the middle of it.
 *
 * It bleeds over the scroll box's side padding (`-mx-3` against the box's `px-3`) so its rule runs
 * edge to edge, and it paints the panel's surface so the rows scrolling under it do not show
 * through (the dock's own canvas). Its `z-10` keeps it above the rows' own positioned content (the timeline's bars).
 */
import type { ReactNode } from "react";

export function TraceToolbar({
  start,
  nav,
  end,
}: {
  /** The file: a picker over a multi-file Session's files, or the one file's label. */
  start?: ReactNode;
  /** The rounds button; absent for a file too short to need a navigator. */
  nav?: ReactNode;
  /** The export control. */
  end?: ReactNode;
}) {
  return (
    <div
      data-slot="toolbar"
      className="sticky top-0 z-10 -mx-3 mb-4 flex items-center gap-2 border-b border-line bg-canvas px-3 py-1.5"
    >
      <div className="flex min-w-0 flex-1 items-center">{start}</div>
      {nav}
      {end}
    </div>
  );
}
