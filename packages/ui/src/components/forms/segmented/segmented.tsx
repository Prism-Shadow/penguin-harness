/**
 * Segmented control, for 2- to 5-way choices (theme, language, messaging channel): the options sit
 * in a well, and the chosen one is a raised chip in the surface colour — lighter than the well in
 * a light theme, the page's own darker surface in a dark one.
 *
 * An option may carry a `badge`: a mini tag pinned at the top-right of its label, for a mark that
 * qualifies the choice itself rather than reporting a state (a beta tag on a work-mode choice). It
 * is positioned out of flow, so neither an option's height nor the control's overall size moves
 * when one appears, and it is hidden from the accessible name; the badge's `name` is what the
 * option's name gains instead, as ` · <name>`.
 *
 * The well is a pressable control's shape (`rounded-control`), and a chip's corner is concentric
 * with it: the well's radius less the well's inset (`p-1`, one space unit), so the chip follows the
 * well's curve at an even distance — a pill in a pill where controls are pills, a small corner in
 * a small one, square in a square. Below zero it is zero.
 */
import type { ReactNode } from "react";

/** The chip's corner: the well's `rounded-control` less its `p-1` inset. */
const SEGMENTED_CHIP_RADIUS =
  "rounded-[max(0px,calc(var(--ui-radius-control)_-_var(--ui-space-unit)))]";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  badge?: { node: ReactNode; name: string };
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  cols = 3,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (v: T) => void;
  cols?: 2 | 3 | 4 | 5;
}) {
  return (
    <div
      // Spelled out rather than interpolated: Tailwind scans for whole class names, and a
      // `grid-cols-${n}` built at runtime is never emitted into the stylesheet.
      className={`grid ${cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-4" : cols === 5 ? "grid-cols-5" : "grid-cols-3"} gap-1 rounded-control bg-line-muted p-1`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          // An aria-label replaces every descendant in the accessible name, so it is only set
          // where there is a badge to fold in — otherwise the label's own text is the name.
          aria-label={opt.badge ? `${opt.label} · ${opt.badge.name}` : undefined}
          aria-pressed={value === opt.value}
          className={`${SEGMENTED_CHIP_RADIUS} px-1 py-1 text-xs transition-colors duration-150 ${
            value === opt.value
              ? "bg-surface font-medium text-fg shadow-sm"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          {opt.badge ? (
            <span className="relative inline-block">
              {opt.label}
              {/* `left-full` rather than a negative right offset: the tag hangs off the label's
                  right edge whatever it is wide, and never overlaps the word. */}
              <span aria-hidden className="absolute -top-1.5 left-full">
                {opt.badge.node}
              </span>
            </span>
          ) : (
            opt.label
          )}
        </button>
      ))}
    </div>
  );
}
