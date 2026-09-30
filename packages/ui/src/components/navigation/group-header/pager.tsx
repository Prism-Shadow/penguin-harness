/**
 * The page stepper of a paged list: a step back, where the reader stands, a step forward.
 * `page` is 0-based; the readout and the accessible names count from 1.
 *
 * Two looks, one control:
 *
 * - `compact` — two flat chevron buttons around a "2/5" readout, no wider than the rows it sits
 *   under (a grouped list in a drawer at phone width). The buttons are glyphs, so their names and
 *   tooltips carry the words.
 * - `labelled` — the readout, then two bordered text buttons (a table's footer, where the steps
 *   have names of their own: "Newer", "Older").
 *
 * The readout is a live region: a step is audible without counting the rows that swapped under
 * it. The buttons disable at the ends, and while `disabled` (a page is loading), so the control
 * never offers a step that goes nowhere.
 */
import { useUiStrings } from "../../../strings";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export type PagerVariant = "compact" | "labelled";

const COMPACT_STEP =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors duration-150 hover:bg-fg/5 hover:text-fg disabled:pointer-events-none disabled:opacity-40";

const LABELLED_STEP =
  "rounded-md border border-line px-2 py-0.5 transition-colors duration-150 hover:bg-line-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export function Pager({
  page,
  pageCount,
  onChange,
  variant = "compact",
  previousLabel,
  nextLabel,
  readout,
  readoutLabel,
  disabled = false,
  className = "",
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  variant?: PagerVariant;
  /** The step back's words: its name and tooltip (compact), or its label (labelled). */
  previousLabel?: string;
  /** The step forward's words. */
  nextLabel?: string;
  /** The position as shown; "2/5" when omitted. */
  readout?: string;
  /** The position as announced, when the readout is not words; the interface's "Page 2 of 5" by default. */
  readoutLabel?: string;
  /** Both steps off, e.g. while the next page loads. */
  disabled?: boolean;
  /** Layout only (a margin, an alignment). */
  className?: string;
}) {
  const strings = useUiStrings();
  const step = (delta: number) => {
    const next = page + delta;
    if (next >= 0 && next < pageCount) onChange(next);
  };
  const back = previousLabel ?? strings.previous;
  const forward = nextLabel ?? strings.next;
  const atStart = disabled || page <= 0;
  const atEnd = disabled || page >= pageCount - 1;
  const spoken =
    readoutLabel ?? (readout === undefined ? strings.pagePosition(page + 1, pageCount) : undefined);
  const position = (
    <span
      aria-live="polite"
      {...(spoken !== undefined ? { "aria-label": spoken } : {})}
      className={
        variant === "compact"
          ? "min-w-[2.5rem] text-center text-xs font-medium tabular-nums text-fg-subtle"
          : "tabular-nums"
      }
    >
      {readout ?? `${page + 1}/${pageCount}`}
    </span>
  );

  if (variant === "labelled") {
    return (
      <div className={`flex items-center gap-2 text-xs text-fg-muted ${className}`}>
        {position}
        <button type="button" disabled={atStart} onClick={() => step(-1)} className={LABELLED_STEP}>
          {back}
        </button>
        <button type="button" disabled={atEnd} onClick={() => step(1)} className={LABELLED_STEP}>
          {forward}
        </button>
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center gap-1.5 px-1.5 py-0.5 ${className}`}>
      <button
        type="button"
        data-tooltip={back}
        aria-label={back}
        disabled={atStart}
        onClick={() => step(-1)}
        className={COMPACT_STEP}
      >
        <GlyphIcon d={ICONS.chevronLeft} size={12} />
      </button>
      {position}
      <button
        type="button"
        data-tooltip={forward}
        aria-label={forward}
        disabled={atEnd}
        onClick={() => step(1)}
        className={COMPACT_STEP}
      >
        <GlyphIcon d={ICONS.chevronRight} size={12} />
      </button>
    </div>
  );
}
