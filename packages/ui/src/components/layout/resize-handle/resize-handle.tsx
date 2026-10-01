/**
 * ResizeHandle: the bar a pointer drags to resize the box beside it — the edge between two
 * columns, or a panel's own edge — drawn in the info tone while it is pointed at and while it is
 * held, and transparent otherwise.
 *
 * The handle reports the pointer and nothing else: every move of a drag hands the caller the
 * native event, and the caller turns its position into a size against its own box (the tree
 * column's left edge, the dock's right edge, a ratio of the page column). That is what lets one
 * bar serve boxes that measure themselves differently. `SplitPane` is the two-column case with
 * that arithmetic done.
 *
 * Two placements. By default the bar is a layout sibling of the box it resizes and costs
 * `RESIZE_HANDLE_PX` of the row, so the boxes on either side always add up to their container.
 * With `edge`, it is an overlay straddling its positioned parent's start or end edge and costs
 * nothing — for a box whose own size is animated, where a sibling would leave a bare strip
 * behind while it collapses.
 *
 * Keyboard: given `onStep`, the bar joins the tab order as a focusable separator reporting its
 * `value` between `min` and `max`, and the arrow keys along its axis step the size. Without it the
 * bar is pointer-only, as a panel edge that also resizes from its own settings is. A double click
 * runs `onReset` (back to the default size) where the caller offers one.
 */
import { useState } from "react";
import type { HTMLAttributes, KeyboardEvent } from "react";
import { usePointerDrag } from "./use-pointer-drag";

/** The bar's thickness in px (`w-1.5` / `h-1.5`): what a layout-sibling handle costs its row. */
export const RESIZE_HANDLE_PX = 6;

/** One arrow-key step, in px: coarse enough to get somewhere, fine enough to land. */
export const RESIZE_STEP_PX = 16;

/** The overlay placements: which edge of the positioned parent the bar straddles, by axis. */
const EDGE_CLASS = {
  x: {
    start: "absolute inset-y-0 -left-[3px] z-20 w-1.5",
    end: "absolute inset-y-0 -right-[3px] z-20 w-1.5",
  },
  y: {
    start: "absolute inset-x-0 -top-[3px] z-20 h-1.5",
    end: "absolute inset-x-0 -bottom-[3px] z-20 h-1.5",
  },
} as const;

export interface ResizeHandleProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "role" | "tabIndex" | "onResize" | "onDoubleClick" | "onKeyDown" | "onPointerDown"
> {
  /**
   * The axis the bar moves along: `x` is an upright bar dragged left and right (between two
   * columns), `y` a flat bar dragged up and down (above a bottom panel).
   */
  axis: "x" | "y";
  /** The bar's accessible name, and its tooltip. */
  label: string;
  /** Every pointer move of a drag, as the native event; the caller measures it against its box. */
  onResize: (event: PointerEvent) => void;
  /** A drag began: a caller that animates the box's size turns that off until it ends. */
  onResizeStart?: () => void;
  /** A drag ended: `committed` on a release (persist the size here, once per drag), not on a cancel. */
  onResizeEnd?: (committed: boolean) => void;
  /** A double click: back to the default size. */
  onReset?: () => void;
  /** The size the bar controls, in px, and its bounds — reported to assistive technology. */
  value?: number;
  min?: number;
  max?: number;
  /**
   * An arrow key along the axis, as the px to move by: positive is right (`x`) or down (`y`).
   * Given, the bar is focusable.
   */
  onStep?: (delta: number) => void;
  /** px per arrow key; `RESIZE_STEP_PX` by default. */
  step?: number;
  /** Straddle the positioned parent's start or end edge instead of taking a place in the row. */
  edge?: "start" | "end";
}

export function ResizeHandle({
  axis,
  label,
  onResize,
  onResizeStart,
  onResizeEnd,
  onReset,
  value,
  min,
  max,
  onStep,
  step = RESIZE_STEP_PX,
  edge,
  className = "",
  ...rest
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);

  const dragProps = usePointerDrag<object>({
    threshold: 0,
    begin: (event) => {
      event.preventDefault(); // no text selection while the bar is dragged
      setDragging(true);
      onResizeStart?.();
      return {};
    },
    onMove: (event) => onResize(event),
    onEnd: () => {
      setDragging(false);
      onResizeEnd?.(true);
    },
    onCancel: () => {
      setDragging(false);
      onResizeEnd?.(false);
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (onStep === undefined) return;
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const forward = axis === "x" ? "ArrowRight" : "ArrowDown";
    const delta = event.key === back ? -step : event.key === forward ? step : 0;
    if (delta === 0) return;
    event.preventDefault();
    onStep(delta);
  };

  const placement =
    edge === undefined
      ? axis === "x"
        ? "w-1.5 shrink-0"
        : "h-1.5 shrink-0"
      : EDGE_CLASS[axis][edge];

  return (
    <div
      {...rest}
      role="separator"
      // The bar's own orientation, which is across the axis it moves along.
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      data-tooltip={label}
      tabIndex={onStep === undefined ? undefined : 0}
      {...dragProps}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className={`${placement} ${axis === "x" ? "cursor-col-resize" : "cursor-row-resize"} outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg-subtle/60 ${
        dragging ? "bg-tone-info-emphasis/60" : "bg-transparent hover:bg-tone-info-emphasis/40"
      } ${className}`}
    />
  );
}
