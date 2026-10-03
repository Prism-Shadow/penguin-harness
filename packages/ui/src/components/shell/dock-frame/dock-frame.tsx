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
 *
 * A surface can go FULLSCREEN, covering the whole window. The box in the flow keeps its size as a
 * placeholder — the conversation beside or above it does not reflow, so nothing under the cover
 * scrolls or refits — and only the content box inside it is laid over the window (`fixed`, at
 * `DOCK_FULLSCREEN_Z`); the bodies are the same elements, so a terminal, a file preview or an
 * editor draft carries over untouched. The handle stays in the flow but inert (its width is part
 * of the placeholder's footprint), the header takes the top safe-area inset the covered mobile top
 * bar normally owns, and a round button floats at the window's bottom-right corner as the way out
 * — on a step above anything laid over the surface by coordinates, since a page covering that
 * corner would hide the only exit. `data-fullscreen` on the root says so to the layers that lay
 * content over the dock.
 */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export type DockEdge = "right" | "bottom";

/**
 * The layer a fullscreen dock surface paints at: level with the in-flow menus (z-40, where the
 * dock wins by document order — it comes after the toolbar and the navigation column in the
 * tree), under the dialogs and drawers (z-50), the portaled menus and tooltips (z-[60]) and the
 * toasts (z-[100]), so the dock's own confirmations, its "+" menu and its tooltips still paint
 * over it. Content laid over the surface by coordinates (the built-in browser's page) takes the
 * step above (+1); the surface's own exit button takes the step above that (+2), so nothing laid
 * over the surface covers the way out.
 */
export const DOCK_FULLSCREEN_Z = 40;

/** A small square header button: the dock's add, detach, move, fullscreen and hide controls. */
export function DockHeaderButton({
  label,
  coarse = false,
  children,
  className = "",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** The accessible name and the tooltip. */
  label: string;
  /**
   * A finger is the pointer: a 24px box is a comfortable mouse target and a poor finger one, so
   * the box grows while the glyph inside keeps its size.
   */
  coarse?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      {...rest}
      className={`flex ${coarse ? "h-8 w-8" : "h-6 w-6"} shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-line-muted hover:text-fg ${className}`}
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
  /** The resize handle, rendered only while open (inert while fullscreen). */
  handle?: ReactNode;
  /** Layers that belong to the dock but float over the page (a drag overlay, a confirmation). */
  overlays?: ReactNode;
  /** The box's node: the resize handle measures it, and a drop preview finds it. */
  rootRef?: Ref<HTMLDivElement>;
  /** The surface covers the whole window (its in-flow box keeps its size underneath). */
  fullscreen?: boolean;
  /** Shown only while `fullscreen`: the floating button's accessible name/tooltip and handler. */
  exitFullscreen?: { label: string; onExit: () => void };
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
  fullscreen = false,
  exitFullscreen,
}: DockFrameProps) {
  const header = (
    <header
      data-testid="dock-header"
      {...headerProps}
      className={`flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-xs ${
        movable ? "cursor-grab select-none" : ""
      } ${fullscreen ? "pt-[calc(0.375rem+env(safe-area-inset-top))]" : ""}`}
    >
      {tabs}
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );

  // The handle keeps its place in the flow while fullscreen — the right dock's is a layout
  // sibling whose width is part of the placeholder's footprint — but takes no pointer and no
  // focus: the content it would resize is laid over the window, not beside the conversation.
  let handleNode: ReactNode = null;
  if (open && fullscreen)
    handleNode = (
      <div inert className="contents">
        {handle}
      </div>
    );
  else if (open) handleNode = handle;

  // The way out, floating clear of the window's bottom-right corner (and of a phone's home
  // indicator), on the launcher ball's glass: quiet at rest, clear under the pointer or the
  // focus. A sibling of the content box rather than a child, on the step above the content laid
  // over the surface.
  const exit =
    fullscreen && exitFullscreen !== undefined ? (
      <button
        type="button"
        data-testid="dock-fullscreen-exit"
        data-tooltip={exitFullscreen.label}
        aria-label={exitFullscreen.label}
        onClick={exitFullscreen.onExit}
        style={{ zIndex: DOCK_FULLSCREEN_Z + 2 }}
        className="ui-glass fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] flex h-10 w-10 items-center justify-center rounded-full border border-line/80 bg-surface/75 text-fg-muted opacity-80 shadow-sm backdrop-blur-md transition-[background-color,color,opacity,box-shadow] duration-150 hover:bg-surface/95 hover:text-fg hover:opacity-100 hover:shadow-lg focus-visible:bg-surface/95 focus-visible:text-fg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* The launcher's entry rung: a glyph alone in a round button floating over content. */}
        <GlyphIcon d={ICONS.cornersIn} size={ICON_SIZE.launcherEntry} />
      </button>
    ) : null;

  // Laid over the window while fullscreen; otherwise the settled box the header and body lay
  // out in, whatever size the outer box is passing through.
  const contentStyle = fullscreen
    ? { zIndex: DOCK_FULLSCREEN_Z }
    : position === "bottom"
      ? { height: contentSize }
      : { width: contentSize };
  const contentClass = fullscreen
    ? "fixed inset-0 flex flex-col bg-canvas pb-[env(safe-area-inset-bottom)]"
    : position === "bottom"
      ? "flex min-h-0 shrink-0 flex-col"
      : "flex min-h-0 flex-1 flex-col";

  if (position === "bottom") {
    return (
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="bottom"
        data-open={open}
        data-layout-motion={animate ? "" : undefined}
        data-fullscreen={fullscreen ? "" : undefined}
        style={{ height: size }}
        inert={!open}
        className={`relative flex w-full shrink-0 flex-col overflow-hidden bg-canvas ${
          open ? "border-t border-line" : ""
        }`}
      >
        {handleNode}
        <div style={contentStyle} className={contentClass}>
          {header}
          {children}
        </div>
        {exit}
        {overlays}
      </div>
    );
  }

  return (
    <>
      {handleNode}
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="right"
        data-open={open}
        data-layout-motion={animate ? "" : undefined}
        data-fullscreen={fullscreen ? "" : undefined}
        style={{ width: size }}
        inert={!open}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-canvas ${
          open ? "border-l border-line" : ""
        }`}
      >
        <div style={contentStyle} className={contentClass}>
          {header}
          {children}
        </div>
        {exit}
        {overlays}
      </div>
    </>
  );
}
