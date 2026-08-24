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
import { panelWidth } from "../chat/use-panel-width";
import { DOCK_MIN_HEIGHT_PX, DOCK_RATIO_MAX, bottomRatio, type DockPosition } from "./dock-state";

/** Fraction of the host's width/height that counts as an edge band for direct drops. */
const EDGE_BAND = 0.45;

function dockHostRect(): DOMRect | null {
  return document.querySelector("[data-dock-host]")?.getBoundingClientRect() ?? null;
}

/** Resolves the drop candidate for a pointer position: widget rectangles first, then edge bands. */
export function dockDropCandidate(x: number, y: number): DockPosition | null {
  const overTarget = document
    .elementFromPoint(x, y)
    ?.closest?.("[data-dock-pos]") as HTMLElement | null;
  if (overTarget?.dataset.dockPos) return overTarget.dataset.dockPos as DockPosition;

  const rect = dockHostRect();
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
 * the stored sizes apply, clamped exactly like the docks' own CSS. The right region's top
 * is the main row (`[data-dock-row]`, below the chat toolbar), the row the right dock
 * really renders in.
 */
function previewStyle(host: DOMRect, position: DockPosition): CSSProperties {
  const existing =
    document
      .querySelector<HTMLElement>(`[data-testid='dock'][data-position='${position}']`)
      ?.getBoundingClientRect() ?? null;
  if (position === "bottom") {
    const height = Math.min(
      existing?.height ??
        Math.max(
          DOCK_MIN_HEIGHT_PX,
          Math.min(DOCK_RATIO_MAX * host.height, bottomRatio() * host.height),
        ),
      host.height,
    );
    return { left: host.left, top: host.bottom - height, width: host.width, height };
  }
  const row = document.querySelector("[data-dock-row]")?.getBoundingClientRect() ?? host;
  const top = Math.max(host.top, row.top);
  const width = Math.min(existing?.width ?? panelWidth(), host.width);
  return { left: host.right - width, top, width, height: row.bottom - top };
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
      className={`${props.shape} rounded-[3px] border transition-colors duration-100 ${
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
export function DockDragOverlay({ candidate }: { candidate: DockPosition | null }) {
  const host = dockHostRect();
  if (!host) return null;

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
          className="pointer-events-none fixed z-[65] rounded-sm border border-sky-400/70 bg-sky-500/20"
          style={previewStyle(host, candidate)}
        />
      )}

      {/* Drop-target widget, kept a comfortable margin off the host's corner. */}
      <div
        data-testid="dock-layout-widget"
        className="fixed z-[70] flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white/95 p-2.5 shadow-lg dark:border-white/20 dark:bg-gray-900/90"
        style={{ left: host.right - 108, top: host.bottom - 96 }}
      >
        <DropTarget position="bottom" candidate={candidate} shape="h-4 w-9" />
        <DropTarget position="right" candidate={candidate} shape="h-9 w-4.5" />
      </div>
    </>,
    document.body,
  );
}
