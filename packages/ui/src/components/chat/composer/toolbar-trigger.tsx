/**
 * A toolbar trigger: the compact button a composer's toolbar opens its pickers from. Two shapes,
 * one look — muted ink that darkens on hover over a soft fill, nothing that moves:
 *
 * - the icon square (no `label`): one glyph at the icon-button rung, with an optional count on its
 *   corner (the skills picked for the message);
 * - the pill (`label`): a leading mark, the words and, with `caret`, the dense caret. The words
 *   hide while the card holding the toolbar is narrower than its `@md` width, leaving the mark,
 *   so a crowded toolbar keeps every control and the tooltip still says what the pill holds.
 *
 * The accessible name is the caller's, and the tooltip unless a longer one is given; the words on
 * a pill are the current value, not the control's name.
 */
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { Count } from "../../feedback/badge/badge";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ChevronDown } from "../../icons/marks/marks";

export interface ToolbarTriggerProps {
  /** The mark: a registry path drawn at the shape's rung, or a node the caller sized (a logo). */
  glyph: string | ReactNode;
  /** The pill's words — the current value. Without them the trigger is the icon square. */
  label?: ReactNode;
  /** The pill's trailing caret. */
  caret?: boolean;
  /** A count on the square's corner; nothing is drawn at 0. */
  badge?: number;
  /** The accessible name. */
  ariaLabel: string;
  /** The tooltip, when it says more than the name (the name with its value). */
  tooltip?: string;
  disabled?: boolean;
  /** How far a pill may grow before its words truncate. */
  width?: "sm" | "md";
  /** Whether the picker it opens is open. */
  expanded?: boolean;
  /** What it opens, when that is not a menu the caller wraps it in (a dialog). */
  ariaHaspopup?: "dialog" | "listbox" | "menu";
  onClick?: () => void;
  /** State a caller or a test reads back off the button (`data-level`). */
  [data: `data-${string}`]: string | number | boolean | undefined;
}

/** The ink, fill and motion both shapes share. */
const LOOK =
  "rounded-md text-fg-muted transition-colors duration-150 hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

const PILL_WIDTH = { sm: "max-w-36", md: "max-w-44" } as const;

export function ToolbarTrigger({
  glyph,
  label,
  caret = false,
  badge = 0,
  ariaLabel,
  tooltip,
  disabled = false,
  width = "sm",
  expanded,
  ariaHaspopup,
  onClick,
  ...data
}: ToolbarTriggerProps) {
  const pill = label !== undefined && label !== null;
  const mark =
    typeof glyph === "string" ? (
      <GlyphIcon d={glyph} {...(pill ? {} : { size: ICON_SIZE.iconButton })} className="shrink-0" />
    ) : (
      glyph
    );
  return (
    <button
      {...data}
      type="button"
      aria-label={ariaLabel}
      data-tooltip={tooltip ?? ariaLabel}
      {...(expanded !== undefined ? { "aria-expanded": expanded } : {})}
      {...(ariaHaspopup !== undefined ? { "aria-haspopup": ariaHaspopup } : {})}
      disabled={disabled}
      onClick={onClick}
      className={
        pill
          ? `flex h-8 ${PILL_WIDTH[width]} shrink-0 items-center gap-1.5 px-2 text-xs ${LOOK}`
          : `relative flex h-8 w-8 shrink-0 items-center justify-center ${LOOK}`
      }
    >
      {mark}
      {pill && <span className="hidden min-w-0 truncate @md:block">{label}</span>}
      {pill && caret && <ChevronDown size={ICON_SIZE.caretDense} />}
      {!pill && badge > 0 && (
        <span className="absolute -right-1 -top-0.5">
          <Count n={badge} />
        </span>
      )}
    </button>
  );
}
