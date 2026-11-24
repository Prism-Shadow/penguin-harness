/**
 * Drag-to-dock: the overlay UI and hit-testing behind dragging a tab (or a whole dock's
 * header) onto the other edge of the chat page.
 *
 * Two ways to pick an edge while dragging, both live-previewing before anything moves:
 * 1. drag straight into an edge band of the chat column (`[data-dock-host]`) — the nearer
 *    of the right/bottom edges within the band is the candidate;
 * 2. drop targets: a small widget near the bottom-right with one rectangle per edge —
 *    hovering a rectangle makes that edge the candidate (and wins over edge detection).
 * The preview is a translucent region covering exactly where the dock would land;
 * releasing the pointer applies the candidate, releasing anywhere else changes nothing.
 *
 * Hit-testing uses elementFromPoint because the drag runs under pointer capture (the
 * strip owns the pointer), so CSS hover never fires on the overlay.
 */
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { dockWidthFor, panelWidth } from "./use-panel-width";
import { bottomDockHeight } from "./bottom-dock-size";
import { composerHeight } from "./composer-height";
import { bottomRatio, type DockPosition } from "./dock-state";

/** Fraction of the host's width/height that counts as an edge band for direct drops. */
const EDGE_BAND = 0.45;

/** Resolves the drop candidate for a pointer position: widget rectangles first, then edge bands. */
export function dockDropCandidate(
  x: number,
  y: number,
  host: HTMLElement | null,
): DockPosition | null {
  const overTarget = document
    .elementFromPoint(x, y)
    ?.closest?.("[data-dock-pos]") as HTMLElement | null;
  if (overTarget?.dataset.dockPos) return overTarget.dataset.dockPos as DockPosition;

  const rect = host?.getBoundingClientRect();
  if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const fractions: Array<[DockPosition, number]> = [
    ["right", (rect.right - x) / rect.width],
    ["bottom", (rect.bottom - y) / rect.height],
  ];
  fractions.sort((a, b) => a[1] - b[1]);
  const nearest = fractions[0]!;
  return nearest[1] <= EDGE_BAND ? nearest[0] : null;
}

/**
 * The exact region a dock at `position` would occupy after the drop — measured from the
 * live layout, not assumed: an already-open dock contributes its rendered rect; otherwise
 * the stored sizes apply, clamped exactly as the docks clamp them. Only an OPEN dock
 * counts: a hidden one stays in the tree at zero size, and measuring that would preview a
 * region of nothing. The right edge spans the whole Session and the bottom stays in its column.
 */
function previewStyle(element: HTMLElement, position: DockPosition): CSSProperties {
  const host = element.getBoundingClientRect();
  const existing =
    element
      .querySelector<HTMLElement>(
        `[data-testid='dock'][data-position='${position}'][data-open='true']`,
      )
      ?.getBoundingClientRect() ?? null;
  if (position === "bottom") {
    const area = element.querySelector("[data-dock-bottom-area]")?.getBoundingClientRect() ?? host;
    const height =
      existing?.height ??
      bottomDockHeight(bottomRatio(), {
        host: host.height,
        area: area.height,
        composer: composerHeight(),
      });
    return { left: area.left, top: area.bottom - height, width: area.width, height };
  }
  const width = existing?.width ?? dockWidthFor(panelWidth(), host.width);
  return { left: host.right - width, top: host.top, width, height: host.height };
}

/** One drop rectangle. A div, not a button: it is only ever "clicked" by a pointer release. */
function DropTarget(props: {
  position: DockPosition;
  candidate: DockPosition | null;
  shape: string;
}) {
  const active = props.candidate === props.position;
  return (
    <div
      data-dock-pos={props.position}
      data-testid="dock-layout-target"
      className={`${props.shape} rounded-[3px] border transition-colors duration-150 ${
        active
          ? "border-sky-400 bg-sky-500/60"
          : "border-gray-400/70 bg-gray-500/10 dark:border-white/30 dark:bg-white/10"
      }`}
    />
  );
}

/**
 * Rendered (through a body portal) only while a tab/header drag is in flight. `candidate`
 * is what the drag currently points at; `null` means "release changes nothing".
 */
export function DockDragOverlay({
  candidate,
  element,
}: {
  candidate: DockPosition | null;
  element: HTMLElement | null;
}) {
  if (!element) return null;
  const host = element.getBoundingClientRect();

  return createPortal(
    <>
      {/* Live preview of the exact region the dock would occupy after the move.
          pointer-events-none so hit-testing underneath (elementFromPoint) keeps seeing the
          drop targets, not the preview. */}
      {candidate && (
        <div
          data-testid="dock-layout-preview"
          data-pos={candidate}
          aria-hidden
          className="pointer-events-none fixed z-drag-preview rounded-sm border border-sky-400/70 bg-sky-500/20"
          style={previewStyle(element, candidate)}
        />
      )}

      {/* Drop-target widget, kept a comfortable margin off the host's corner. */}
      <div
        data-testid="dock-layout-widget"
        className="fixed z-drag-preview flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white/95 p-2 shadow-lg dark:border-white/20 dark:bg-gray-900/90"
        style={{ left: host.right - 108, top: host.bottom - 96 }}
      >
        <DropTarget position="bottom" candidate={candidate} shape="h-4 w-9" />
        <DropTarget position="right" candidate={candidate} shape="h-9 w-4.5" />
      </div>
    </>,
    document.body,
  );
}
