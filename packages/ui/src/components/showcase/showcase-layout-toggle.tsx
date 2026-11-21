/**
 * A showcase grid's cards / list switch: two flat icon buttons side by side — four squares for
 * the cards, squares with lines of text beside them for the list. The current one is pressed and
 * in the body's ink; the other is in the muted ink and deepens on hover. Neither has a box at
 * rest or on hover, like every icon-only control here.
 *
 * Each button names itself (`aria-label`) and shows the same words on hover; the group names
 * what it switches. The marks are the registry's `layoutGrid` and `layoutList` in their line
 * drawing, in every theme (showcase-mark.tsx). The Web App's tooltip layer reads
 * `data-tooltip`; the public sites mount no tooltip layer, so with `nativeTooltips` each button
 * carries a `title` instead.
 *
 * Pressing the current layout changes nothing. Props only: every word is the caller's. The look
 * is showcase.css.
 */
import { ICONS } from "../icons/icons";
import type { ShowcaseLayout } from "./cover-card";
import { ShowcaseMark } from "./showcase-mark";

export interface ShowcaseLayoutToggleProps {
  value: ShowcaseLayout;
  onChange: (layout: ShowcaseLayout) => void;
  /** The group's name, and each layout's: its accessible name and its hover words. */
  labels: { group: string; cards: string; list: string };
  /** Hover words as a native `title`, for a page with no tooltip layer (the public sites). */
  nativeTooltips?: boolean;
  className?: string;
}

const OPTIONS = [
  { layout: "cards", glyph: ICONS.layoutGrid },
  { layout: "list", glyph: ICONS.layoutList },
] as const;

export function ShowcaseLayoutToggle({
  value,
  onChange,
  labels,
  nativeTooltips = false,
  className = "",
}: ShowcaseLayoutToggleProps) {
  return (
    <div
      role="group"
      aria-label={labels.group}
      className={`showcase showcase-layout-toggle ${className}`}
    >
      {OPTIONS.map(({ layout, glyph }) => {
        const label = labels[layout];
        return (
          <button
            key={layout}
            type="button"
            className="showcase-layout-option"
            aria-label={label}
            aria-pressed={value === layout}
            {...(nativeTooltips ? { title: label } : { "data-tooltip": label })}
            onClick={() => {
              if (layout !== value) onChange(layout);
            }}
          >
            <ShowcaseMark d={glyph} />
          </button>
        );
      })}
    </div>
  );
}
