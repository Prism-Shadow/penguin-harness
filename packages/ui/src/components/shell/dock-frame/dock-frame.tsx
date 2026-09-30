/**
 * A dock surface's frame: the header (the tab strip, a spacer, the action cluster) above the
 * shown tab's body, in a box that opens from an edge of the page — the bottom (a full-width
 * band) or the right (a column beside the conversation).
 *
 * The frame never unmounts to hide: a closed dock stays in the tree at size 0 and inert, so the
 * bodies inside keep their scroll, their drill-down and their unsaved text, and `data-open` says
 * what is on screen. Its size is the caller's, in pixels: `size` is what the box shows (0 while
 * collapsed or before the entrance), `contentSize` the settled size its content lays out at, so
 * while the box animates past intermediate sizes nothing inside reflows — text does not squeeze
 * and a terminal does not refit its grid on every frame. The animation is the theme's layout
 * motion, off while a drag resizes or a flip must land at once.
 *
 * The border belongs to the open state only: with border-box sizing a collapsed dock would still
 * paint its 1px, leaving a hairline where nothing is. The resize handle is the caller's too, shown
 * only while open: an overlay straddling the bottom dock's top edge (it costs no height), and a
 * layout sibling before the right dock (it must cost real width, so the conversation measures
 * the same under every surface).
 */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from "react";

export type DockEdge = "right" | "bottom";

/** A small square header button: the dock's add, detach, move and hide controls. */
export function DockHeaderButton({
  label,
  children,
  className = "",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** The accessible name and the tooltip. */
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      {...rest}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-line-muted hover:text-fg ${className}`}
    >
      {children}
    </button>
  );
}

export interface DockFrameProps {
  position: DockEdge;
  /** False while the dock collapses on its way out: it stays mounted at size 0, inert. */
  open: boolean;
  /** The box's size on screen (px): the bottom dock's height, the right dock's width. */
  size: number;
  /** The settled size the content lays out at (px), whatever the box is passing through. */
  contentSize: number;
  /** Whether a change of `size` animates. */
  animate: boolean;
  /** The tab strip (`DockTabs`). */
  tabs: ReactNode;
  /** The header's right-hand cluster, evenly spaced, ending in the dock's hide button. */
  actions: ReactNode;
  /**
   * Pointer handlers on the header, for a caller that lets the header drag the whole dock.
   * `movable` shows the grab cursor for it.
   */
  headerProps?: HTMLAttributes<HTMLElement>;
  movable?: boolean;
  /** The shown tab's body, or the picker while the dock has no tabs. */
  children: ReactNode;
  /** The resize handle, rendered only while open. */
  handle?: ReactNode;
  /** Layers that belong to the dock but float over the page (a drag overlay, a confirmation). */
  overlays?: ReactNode;
  /** The box's node: the resize handle measures it, and a drop preview finds it. */
  rootRef?: Ref<HTMLDivElement>;
}

export function DockFrame({
  position,
  open,
  size,
  contentSize,
  animate,
  tabs,
  actions,
  headerProps,
  movable = false,
  children,
  handle,
  overlays,
  rootRef,
}: DockFrameProps) {
  const header = (
    <header
      data-testid="dock-header"
      {...headerProps}
      className={`flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-xs ${
        movable ? "cursor-grab select-none" : ""
      }`}
    >
      {tabs}
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );

  if (position === "bottom") {
    return (
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="bottom"
        data-open={open}
        data-layout-motion={animate ? "" : undefined}
        style={{ height: size }}
        inert={!open}
        className={`relative flex w-full shrink-0 flex-col overflow-hidden bg-canvas ${
          open ? "border-t border-line" : ""
        }`}
      >
        {open && handle}
        <div style={{ height: contentSize }} className="flex min-h-0 shrink-0 flex-col">
          {header}
          {children}
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <>
      {open && handle}
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="right"
        data-open={open}
        data-layout-motion={animate ? "" : undefined}
        style={{ width: size }}
        inert={!open}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-canvas ${
          open ? "border-l border-line" : ""
        }`}
      >
        <div style={{ width: contentSize }} className="flex min-h-0 flex-1 flex-col">
          {header}
          {children}
        </div>
        {overlays}
      </div>
    </>
  );
}
