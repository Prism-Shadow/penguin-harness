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
import {
  DOCK_MIN_HEIGHT_PX,
  DOCK_MIN_WIDTH_PX,
  DOCK_RATIO_MAX,
  isHorizontal,
  paneRatio,
  type DockPosition,
} from "./terminal-dock-state";

/** Fraction of the host's width/height that counts as an edge band for direct drops. */
const EDGE_BAND = 0.45;

function dockHostRect(): DOMRect | null {
  return document.querySelector("[data-dock-host]")?.getBoundingClientRect() ?? null;
}

/**
 * Everything needed to draw the preview as the region a pane at the candidate edge would
 * REALLY occupy — measured from the live layout, not assumed:
 * - a pane already open on that edge contributes its exact rendered rect;
 * - otherwise the edge's stored ratio applies, clamped exactly like the pane's own CSS
 *   (px minimums, ratio ceiling);
 * - `contentTop` excludes the host's non-dock chrome (mobile header, notice banner): the
 *   layout row starts below that chrome, so its top is the content top.
 */
interface DockGeometry {
  host: DOMRect;
  contentTop: number;
}

function clampSize(value: number, minPx: number, max: number): number {
  return Math.min(max, Math.max(Math.min(minPx, max), value));
}

function measureDockGeometry(): DockGeometry | null {
  const host = dockHostRect();
  if (!host) return null;
  const row = document.querySelector("[data-dock-row]")?.getBoundingClientRect() ?? null;
  const contentTop = row ? Math.max(host.top, row.top) : host.top;
  return { host, contentTop };
}

/** The rendered rect of an already-open pane at `position`, if any. */
function openPaneRect(position: DockPosition): DOMRect | null {
  return (
    document
      .querySelector<HTMLElement>(`[data-testid='terminal-dock'][data-position='${position}']`)
      ?.getBoundingClientRect() ?? null
  );
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

/** The exact region a pane at `position` would occupy after the drop. */
function previewStyle(geometry: DockGeometry, position: DockPosition): CSSProperties {
  const { host, contentTop } = geometry;
  const contentHeight = host.bottom - contentTop;
  const existing = openPaneRect(position);
  // Height percentages resolve against the HOST column (top/bottom panes are its direct
  // children), so the ratio's px value uses host.height — the region is then clipped to
  // the content area below the chrome.
  const height = Math.min(
    existing && isHorizontal(position)
      ? existing.height
      : clampSize(
          paneRatio(position) * host.height,
          DOCK_MIN_HEIGHT_PX,
          DOCK_RATIO_MAX * host.height,
        ),
    contentHeight,
  );
  const width = Math.min(
    existing && !isHorizontal(position)
      ? existing.width
      : clampSize(paneRatio(position) * host.width, DOCK_MIN_WIDTH_PX, DOCK_RATIO_MAX * host.width),
    host.width,
  );
  switch (position) {
    case "top":
      return { left: host.left, top: contentTop, width: host.width, height };
    case "bottom":
      return { left: host.left, top: host.bottom - height, width: host.width, height };
    case "left":
      return { left: host.left, top: contentTop, width, height: contentHeight };
    case "right":
      return { left: host.right - width, top: contentTop, width, height: contentHeight };
  }
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
        active ? "border-sky-400 bg-sky-500/60" : "border-white/30 bg-white/10"
      }`}
    />
  );
}

/**
 * Rendered (through a body portal) only while a header drag is in flight. `candidate` is
 * what the drag currently points at; `null` means "release changes nothing".
 */
export function DockLayoutOverlay({ candidate }: { candidate: DockPosition | null }) {
  const geometry = measureDockGeometry();
  if (!geometry) return null;
  const rect = geometry.host;

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
          style={previewStyle(geometry, candidate)}
        />
      )}

      {/* Drop-target widget: a top/bottom container and a left/right container, kept a
          comfortable margin off the host's corner. */}
      <div
        data-testid="dock-layout-widget"
        className="fixed z-[70] flex items-center gap-3"
        style={{ left: rect.right - 172, top: rect.bottom - 96 }}
      >
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-white/20 bg-gray-900/90 p-2.5 shadow-lg">
          <DropTarget position="top" candidate={candidate} shape="h-3.5 w-10" />
          <DropTarget position="bottom" candidate={candidate} shape="h-3.5 w-10" />
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-gray-900/90 p-2.5 shadow-lg">
          <DropTarget position="left" candidate={candidate} shape="h-9 w-4.5" />
          <DropTarget position="right" candidate={candidate} shape="h-9 w-4.5" />
        </div>
      </div>
    </>,
    document.body,
  );
}
