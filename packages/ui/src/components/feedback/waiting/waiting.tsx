/**
 * The waiting state: what a page, a tab, a settings page or a list shows while its data is on the
 * way. It is the one loading placeholder; a spinner is for an action that runs, never for a region
 * waiting on its data.
 *
 * - **Only when the wait is slow.** For the first {@link WAITING_DELAY_MS} after it mounts the host
 *   is laid out but not shown (`data-state="pending"`). A read that answers inside that window
 *   replaces it before anything was seen, so a quick switch goes straight from one content to the
 *   next. After it the host shows (`"shown"`).
 * - **The layout holds.** The blocks take their space from the first frame, shown or not, in the
 *   shape of what is coming: a list's rows, a page's title and body, or the caller's own blocks.
 *   Nothing around the host moves when it shows, and the content lands where it stood.
 * - **Announced once shown.** The host is a polite status region whose words are written when it
 *   shows, so a screen reader hears nothing of a quick load; the blocks are hidden from it.
 * - **The theme's.** The host carries the `ui-waiting` hook with its state and its form, and its
 *   blocks are the `Skeleton` shapes (`data-skeleton`). theme.css hides the host while pending,
 *   brings it in on the theme's entrance and lets the blocks breathe on the theme's live timing
 *   (Console steps them). Reduced motion shows it at once and holds the blocks still.
 *
 * A wait starts when the host mounts, so a caller renders it in place of what is loading and
 * unmounts it when the data lands. A caller that already holds the data (a revisited tab, a
 * refresh in place) keeps showing it and never renders the host at all.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Skeleton } from "../skeleton/skeleton";

/** How long a wait shows nothing, in ms: a load that answers sooner never shows a placeholder. */
export const WAITING_DELAY_MS = 200;

/** The placeholder's built-in shapes: a list's rows, or a page's title line and body. */
export type WaitingForm = "rows" | "page";

export interface WaitingProps {
  /** What is awaited, announced once the wait shows; the package's "Loading…" when omitted. */
  label?: string;
  /** `rows` (the default): a list's row-height blocks. `page`: a page's title line and body. */
  form?: WaitingForm;
  /** How many rows the `rows` form draws (default 3). */
  rows?: number;
  /** The caller's own blocks, shaped like what is coming (`Skeleton`, `SkeletonCard`); replaces the form. */
  children?: ReactNode;
  /**
   * The host's own layout: its padding, its gap, a grid. It replaces the form's default outright —
   * two utilities for one property resolve by stylesheet order, not by position in the string.
   */
  className?: string;
  /** How long nothing shows; {@link WAITING_DELAY_MS} by default. */
  delay?: number;
}

/** Each form's layout when the caller gives none: the rows' gutter, the page's breathing room. */
const FORM_CLASS: Record<WaitingForm | "custom", string> = {
  rows: "space-y-2 p-2",
  page: "space-y-3 py-2",
  custom: "",
};

/** Whether `ms` have passed since the caller mounted. */
function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) {
      setElapsed(true);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return elapsed;
}

export function Waiting({
  label,
  form = "rows",
  rows = 3,
  children,
  className,
  delay = WAITING_DELAY_MS,
}: WaitingProps) {
  const strings = useUiStrings();
  const shown = useElapsed(delay);
  const shape = children !== undefined ? "custom" : form;
  return (
    <div
      role="status"
      data-state={shown ? "shown" : "pending"}
      data-form={shape}
      className={`ui-waiting ${className ?? FORM_CLASS[shape]}`}
    >
      <span className="sr-only">{shown ? (label ?? strings.loading) : ""}</span>
      {shape === "custom" ? (
        children
      ) : shape === "page" ? (
        <>
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="h-32 w-full" />
        </>
      ) : (
        Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)
      )}
    </div>
  );
}
