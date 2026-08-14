/**
 * Drag-to-dock: the overlay UI and hit-testing behind dragging the dock's header to move
 * the terminal panel to another edge of the content area.
 *
 * Two ways to pick a position while dragging, both live-previewing before anything moves:
 * 1. drag straight into an edge band of the content area (`[data-dock-host]`, the column
 *    AppLayout lays the dock out in) — the nearest edge within the band is the candidate;
 * 2. drop targets: a small widget in the bottom-right of the content area with two
 *    containers — a top/bottom pair and a left/right pair of rectangles — hovering a
 *    rectangle makes that edge the candidate (and wins over edge detection).
 * The preview is a translucent region covering exactly where the dock would land;
 * releasing the pointer applies the candidate, releasing anywhere else changes nothing.
 *
 * Hit-testing uses elementFromPoint because the drag runs under pointer capture (the
 * header owns the pointer), so CSS hover never fires on the overlay.
 */
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { DockPosition } from "./terminal-dock-state";

/** Fraction of the host's width/height that counts as an edge band for direct drops. */
const EDGE_BAND = 0.28;
/** Matches the dock's own sizes (h-72 / w-[26rem]) so the preview is truthful. */
const DOCK_HEIGHT_PX = 288;
const DOCK_WIDTH_PX = 416;

export function dockHostRect(): DOMRect | null {
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
    ["left", (x - rect.left) / rect.width],
    ["right", (rect.right - x) / rect.width],
    ["top", (y - rect.top) / rect.height],
    ["bottom", (rect.bottom - y) / rect.height],
  ];
  fractions.sort((a, b) => a[1] - b[1]);
  const nearest = fractions[0]!;
  return nearest[1] <= EDGE_BAND ? nearest[0] : null;
}

function previewStyle(rect: DOMRect, position: DockPosition): CSSProperties {
  const height = Math.min(DOCK_HEIGHT_PX, rect.height);
  const width = Math.min(DOCK_WIDTH_PX, rect.width);
  switch (position) {
    case "top":
      return { left: rect.left, top: rect.top, width: rect.width, height };
    case "bottom":
      return { left: rect.left, top: rect.bottom - height, width: rect.width, height };
    case "left":
      return { left: rect.left, top: rect.top, width, height: rect.height };
    case "right":
      return { left: rect.right - width, top: rect.top, width, height: rect.height };
  }
}

/** One drop rectangle. A div, not a button: it is only ever "clicked" by a pointer release. */
function DropTarget(props: { position: DockPosition; candidate: DockPosition | null; shape: string }) {
  const active = props.candidate === props.position;
  return (
    <div
      data-dock-pos={props.position}
      data-testid="dock-layout-target"
      className={`${props.shape} rounded-[3px] border transition-colors duration-100 ${
        active
          ? "border-sky-400 bg-sky-500/60"
          : "border-white/30 bg-white/10"
      }`}
    />
  );
}

/**
 * Rendered (through a body portal) only while a header drag is in flight. `candidate` is
 * what the drag currently points at; `null` means "release changes nothing".
 */
export function DockLayoutOverlay({ candidate }: { candidate: DockPosition | null }) {
  const rect = dockHostRect();
  if (!rect) return null;

  return createPortal(
    <>
      {/* Live preview of where the dock would land. pointer-events-none so hit-testing
          underneath (elementFromPoint) keeps seeing the drop targets, not the preview. */}
      {candidate && (
        <div
          data-testid="dock-layout-preview"
          data-pos={candidate}
          aria-hidden
          className="pointer-events-none fixed z-[65] rounded-sm border border-sky-400/70 bg-sky-500/20"
          style={previewStyle(rect, candidate)}
        />
      )}

      {/* Drop-target widget: a top/bottom container and a left/right container. */}
      <div
        data-testid="dock-layout-widget"
        className="fixed z-[70] flex items-center gap-2"
        style={{ left: rect.right - 120, top: rect.bottom - 64 }}
      >
        <div className="flex flex-col gap-1 rounded-md border border-white/20 bg-gray-900/90 p-1.5 shadow-lg">
          <DropTarget position="top" candidate={candidate} shape="h-3.5 w-9" />
          <DropTarget position="bottom" candidate={candidate} shape="h-3.5 w-9" />
        </div>
        <div className="flex gap-1 rounded-md border border-white/20 bg-gray-900/90 p-1.5 shadow-lg">
          <DropTarget position="left" candidate={candidate} shape="h-8 w-4" />
          <DropTarget position="right" candidate={candidate} shape="h-8 w-4" />
        </div>
      </div>
    </>,
    document.body,
  );
}
