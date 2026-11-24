/**
 * The app window's navigation column (`AppShell`'s `nav` slot): the pinned sidebar, or the rail
 * while it is folded, and, where the caller lets the reader size it, the handle on its end edge.
 *
 * Width. Folded, the column is the rail's width. Open, it is the theme's own width until the
 * reader drags the edge, and from then on the dragged width in px, brought within the current
 * window's bounds (nav-width.ts) as it is drawn: a window that narrows shows the column at its
 * ceiling without touching the width the caller keeps, so the column comes back as the window
 * widens again.
 *
 * The fold animates the column's width through the theme's layout motion (`data-layout-motion`),
 * the one property this box may animate at all: the column is in flow, so the main column
 * reflows beside it rather than being slid over, and a transform, a `will-change` or an opacity
 * below 1 would each make it a stacking context and trap the menus the column opens. Its content
 * is laid out at the width it will keep and clipped, so it never reflows mid-fold: the rail sits
 * at its final width from the first frame while the column closes around it, and the pinned
 * sidebar is uncovered left to right.
 *
 * The handle (`ResizeHandle`) straddles the column's end edge as an overlay and costs no width,
 * because the column's own width animates. That is why the clipping is an inner box and not the
 * column itself, which would cut off the handle's outer half. While a drag holds the handle the
 * column follows the pointer with the layout motion off (left on, the width would trail a fifth
 * of a second behind the pointer), and the caller hears of the width once, on the release. An
 * arrow key, and a double click back to the theme's width, reach the caller at once and keep the
 * motion, so the column eases to its new width. Folding mid-drag drops the drag: the rail has no
 * handle.
 *
 */
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useMeasuredWidth } from "../../layout/measure/use-measured-width";
import { ResizeHandle } from "../../layout/resize-handle/resize-handle";
import { clampNavWidth, NAV_MIN_WIDTH, navMaxWidth } from "./nav-width";
import { NavigationBackdrop } from "./wallpaper";

/** Lets the reader size the open column by dragging its end edge. */
export interface NavResize {
  /** The width the reader gave the column, in px; null keeps the theme's own width. */
  width: number | null;
  /** The handle's accessible name and tooltip. */
  label: string;
  /**
   * The width to keep, once per gesture (a drag's release, an arrow key), already within the
   * bounds; null on a double click, back to the theme's own width. The caller stores it and
   * hands it back as `width`.
   */
  onChange: (width: number | null) => void;
}

/** The theme's own widths, as classes: folded to the rail, and open until the edge is dragged. */
const RAIL_WIDTH = " w-12";
const THEME_WIDTH = " w-64 lg:w-72";

const subscribeToResize = (onChange: () => void): (() => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

/** The window's width, followed as it resizes; 0 where there is no window (static markup). */
function useWindowWidth(): number {
  return useSyncExternalStore(
    subscribeToResize,
    () => window.innerWidth,
    () => 0,
  );
}

export function NavColumn({
  collapsed,
  resize,
  children,
}: {
  /** Folded to the rail's width. */
  collapsed: boolean;
  /** Given, the open column's end edge carries the resize handle. */
  resize?: NavResize;
  /** The pinned sidebar, or the rail while folded. */
  children: ReactNode;
}) {
  const windowWidth = useWindowWidth();
  const columnRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The width a drag has asked for while it holds the handle, and the last one handed out, which
  // is what the release keeps: the state may still be a render behind the pointer by then.
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const requested = useRef<number | null>(null);
  // Folding mid-drag drops the drag in the same render, so the fold itself keeps its motion.
  const [shownCollapsed, setShownCollapsed] = useState(collapsed);
  if (shownCollapsed !== collapsed) {
    setShownCollapsed(collapsed);
    setDragging(false);
    setLive(null);
  }

  const chosen = resize?.width ?? null;
  // The width drawn, in px; null while a class gives it (the rail, or the theme's own width).
  const width = collapsed
    ? null
    : (live ?? (chosen === null ? null : clampNavWidth(chosen, windowWidth)));
  const sizeClass = collapsed ? RAIL_WIDTH : width === null ? THEME_WIDTH : "";
  const sizeStyle = width === null ? undefined : { width };
  // The theme's width as laid out, for the handle to report and to step from: measured only
  // while it is the width shown.
  const themeWidth = useMeasuredWidth(contentRef);
  const measuring = !collapsed && width === null;
  const shown = width ?? (themeWidth > 0 ? themeWidth : undefined);

  const follow = (event: PointerEvent): void => {
    // Against the column's own start edge rather than an accumulated delta, so a drag that
    // outruns the bounds comes back in step instead of offset by however far it overshot.
    const start = columnRef.current?.getBoundingClientRect().left ?? 0;
    const next = clampNavWidth(event.clientX - start, windowWidth);
    requested.current = next;
    setLive(next);
  };
  const begin = (): void => {
    requested.current = null;
    setDragging(true);
  };
  const end = (committed: boolean): void => {
    const next = requested.current;
    requested.current = null;
    // A press that never moved (each half of a double click) keeps the width it found.
    if (committed && next !== null) resize?.onChange(next);
    setDragging(false);
    setLive(null);
  };
  const step = (delta: number): void => {
    if (shown !== undefined) resize?.onChange(clampNavWidth(shown + delta, windowWidth));
  };

  return (
    <aside
      ref={columnRef}
      data-slot="nav"
      data-layout-motion={dragging ? undefined : true}
      style={sizeStyle}
      className={`relative hidden shrink-0 border-r border-line bg-surface-muted md:block${sizeClass}`}
    >
      <NavigationBackdrop />
      <div className="h-full overflow-hidden">
        <div
          ref={measuring ? contentRef : undefined}
          style={sizeStyle}
          className={`h-full${sizeClass}`}
        >
          {children}
        </div>
      </div>
      {resize !== undefined && !collapsed && (
        <ResizeHandle
          axis="x"
          edge="end"
          label={resize.label}
          value={shown}
          min={NAV_MIN_WIDTH}
          max={navMaxWidth(windowWidth)}
          onResizeStart={begin}
          onResize={follow}
          onResizeEnd={end}
          onStep={step}
          onReset={() => resize.onChange(null)}
        />
      )}
    </aside>
  );
}
