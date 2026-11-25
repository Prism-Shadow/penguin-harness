/**
 * Call-graph rendering for the subagents panel: a pan-and-zoom canvas (like the company org
 * chart's, view arithmetic in lib/canvas-view.ts) holding an SVG layer for the edges and
 * absolutely positioned real <button> nodes on top (real buttons keep keyboard focus, aria
 * naming, and CSS text truncation for free — an all-SVG node would have to reinvent each).
 * Geometry comes from the pure layoutTopology (agent-topology.ts), placed in one transformed
 * drawing layer so panning and zooming never re-layout a node. It opens fitted — the whole tree
 * visible and centred, shrunk to fit when wider or taller than the frame and never enlarged past
 * 100% — and from there the wheel zooms around the cursor, a drag pans, and the header's − / +
 * step around the frame's centre while the percent readout returns to the fit.
 *
 * Each child node shows its wall-clock elapsed time (ticking while it runs, frozen at its last
 * activity when done — never a sum of its items); the root carries no stamps and shows none.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AgentAvatar,
  Button,
  DurationSlot,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  StatusIcon,
  Text,
} from "@prismshadow/penguin-ui";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampView,
  fitView,
  panBy,
  viewTransform,
  wheelZoomFactor,
  zoomAt,
  type CanvasSize,
  type CanvasView,
} from "../../lib/canvas-view";
import { S } from "../../lib/strings";
import { layoutTopology, NODE_H, NODE_W, type TopologyNode } from "./agent-topology";

/** Canvas height bounds (px): room for a 1-row tree to breathe, capped so the conversation below stays tall. */
const CANVAS_MIN_H = 88;
const CANVAS_MAX_H = 192;
const CANVAS_PAD_Y = 16;
/** One arrow-key press on the focused canvas, in frame pixels. */
const CANVAS_KEY_PAN = 48;
/** Pointer movement (px) that turns a press into a canvas pan rather than a node click. */
const PAN_SLOP_PX = 4;

export function AgentTopologyView({
  nodes,
  selectedId,
  labelFor,
  avatarFor,
  onSelect,
  pager,
  notice,
}: {
  nodes: TopologyNode[];
  /** Session id of the highlighted node (null — e.g. a focused child from an older Task — highlights nothing). */
  selectedId: string | null;
  /** Resolved display label for a node (the view owns name resolution; the graph only renders it). */
  labelFor: (node: TopologyNode) => string;
  /** A node's Agent's own picture, when it has one (resolved by the view, like the label). */
  avatarFor: (node: TopologyNode) => string | undefined;
  onSelect: (node: TopologyNode) => void;
  /** Optional turn pager rendered at the right end of the header row. */
  pager?: ReactNode;
  /** Optional status/error line rendered between the header row and the canvas. */
  notice?: ReactNode;
}) {
  const layout = useMemo(() => layoutTopology(nodes), [nodes]);
  const drawing = useMemo<CanvasSize>(
    () => ({ width: layout.width, height: layout.height }),
    [layout.width, layout.height],
  );
  const canvasHeight = Math.min(CANVAS_MAX_H, Math.max(CANVAS_MIN_H, layout.height + CANVAS_PAD_Y));

  /** The view the reader moved to; null follows the fit, which is what the canvas opens at. */
  const [view, setView] = useState<CanvasView | null>(null);
  const [frame, setFrame] = useState<CanvasSize>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);

  // Switching to another Task turn or spawning additional subagents re-fits the canvas to the tree.
  const topologyKey = nodes.map((n) => `${n.parentId ?? ""}>${n.sessionId}`).join("\n");
  const prevTopologyRef = useRef(topologyKey);
  useEffect(() => {
    if (prevTopologyRef.current !== topologyKey) {
      prevTopologyRef.current = topologyKey;
      setView(null);
    }
  }, [topologyKey]);

  const fit = useMemo(() => fitView(frame, drawing), [frame, drawing]);
  const current = useMemo(
    () => (view === null ? fit : clampView(view, frame, drawing)),
    [view, fit, frame, drawing],
  );
  const percent = Math.round(current.scale * 100);

  const live = useRef({ view: current, frame, drawing });
  live.current = { view: current, frame, drawing };

  const applyView = useCallback((next: CanvasView) => {
    setView(clampView(next, live.current.frame, live.current.drawing));
  }, []);

  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const { view: from, frame: box } = live.current;
      const centre = { x: box.width / 2, y: box.height / 2 };
      applyView(zoomAt(from, centre, direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP));
    },
    [applyView],
  );

  const measure = useCallback(() => {
    if (frameEl === null) return;
    const rect = frameEl.getBoundingClientRect();
    const width = frameEl.clientWidth || rect.width;
    const height = frameEl.clientHeight || rect.height || canvasHeight;
    if (width <= 0 || height <= 0) return;
    setFrame((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    );
  }, [frameEl, canvasHeight]);
  useLayoutEffect(measure);
  useEffect(() => {
    if (frameEl === null) return;
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    ro?.observe(frameEl);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [frameEl, measure]);

  // Wheel zooms around the cursor (trackpad pinch arrives as ctrl+wheel). Registered non-passive
  // so preventDefault stops any outer scroll.
  useEffect(() => {
    if (frameEl === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frameEl.getBoundingClientRect();
      const pointer = {
        x: event.clientX - rect.left - frameEl.clientLeft,
        y: event.clientY - rect.top - frameEl.clientTop,
      };
      applyView(zoomAt(live.current.view, pointer, wheelZoomFactor(event.deltaY, event.deltaMode)));
    };
    frameEl.addEventListener("wheel", onWheel, { passive: false });
    return () => frameEl.removeEventListener("wheel", onWheel);
  }, [frameEl, applyView]);

  const suppressClickRef = useRef(false);
  const dragCleanRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanRef.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragCleanRef.current?.();
    suppressClickRef.current = false;
    // Pressing on the canvas background (not a node button) focuses the canvas for keyboard zoom/pan.
    if (!(event.target instanceof Element && event.target.closest("button") !== null)) {
      event.currentTarget.focus();
    }
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startView = live.current.view;
    let started = false;
    let captured = false;

    const onMove = (native: PointerEvent) => {
      if (native.pointerId !== pointerId) return;
      const dx = native.clientX - startX;
      const dy = native.clientY - startY;
      if (!started) {
        if (Math.hypot(dx, dy) < PAN_SLOP_PX) return;
        started = true;
        suppressClickRef.current = true;
        setPanning(true);
        try {
          element.setPointerCapture(pointerId);
          captured = true;
        } catch {
          // Ignore if capture is unavailable.
        }
      }
      applyView(panBy(startView, dx, dy));
    };

    const finish = (native: PointerEvent) => {
      if (native.pointerId !== pointerId) return;
      cleanup();
    };

    const onLostCapture = () => {
      captured = false;
    };

    const cleanup = () => {
      dragCleanRef.current = null;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      element.removeEventListener("lostpointercapture", onLostCapture);
      if (captured) {
        captured = false;
        try {
          element.releasePointerCapture(pointerId);
        } catch {
          // Already released.
        }
      }
      if (started) setPanning(false);
    };

    dragCleanRef.current = cleanup;
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    element.addEventListener("lostpointercapture", onLostCapture);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    if (event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const from = live.current.view;
    switch (event.key) {
      case "+":
      case "=":
        zoomStep(1);
        break;
      case "-":
      case "_":
        zoomStep(-1);
        break;
      case "0":
        setView(null);
        break;
      case "ArrowLeft":
        applyView(panBy(from, CANVAS_KEY_PAN, 0));
        break;
      case "ArrowRight":
        applyView(panBy(from, -CANVAS_KEY_PAN, 0));
        break;
      case "ArrowUp":
        applyView(panBy(from, 0, CANVAS_KEY_PAN));
        break;
      case "ArrowDown":
        applyView(panBy(from, 0, -CANVAS_KEY_PAN));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const showCanvas = nodes.length > 1;
  const zoomControl = (
    <div className="flex items-center" role="group" aria-label={S.subagentPanel.zoom}>
      <Button
        size="icon-sm"
        variant="ghost"
        title={S.subagentPanel.zoomOut}
        aria-label={S.subagentPanel.zoomOut}
        disabled={current.scale <= ZOOM_MIN}
        onClick={() => zoomStep(-1)}
      >
        <GlyphIcon d={ICONS.minus} size={ICON_SIZE.rowLead} />
      </Button>
      <button
        type="button"
        data-tooltip={S.subagentPanel.zoomFit}
        aria-label={`${S.subagentPanel.zoomFit} · ${percent}%`}
        onClick={() => setView(null)}
        className="min-w-10 rounded-md px-1 py-0.5 text-center text-xs text-gray-600 tabular-nums transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        {percent}%
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        title={S.subagentPanel.zoomIn}
        aria-label={S.subagentPanel.zoomIn}
        disabled={current.scale >= ZOOM_MAX}
        onClick={() => zoomStep(1)}
      >
        <GlyphIcon d={ICONS.plus} size={ICON_SIZE.rowLead} />
      </Button>
    </div>
  );

  return (
    <div>
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
        <Text variant="eyebrow" className="min-w-0 truncate">
          {S.subagentPanel.topologyLabel}
        </Text>
        {(showCanvas || pager) && (
          <div className="flex shrink-0 items-center gap-1">
            {showCanvas && zoomControl}
            {pager}
          </div>
        )}
      </div>
      {notice}
      {showCanvas && (
        <div
          ref={setFrameEl}
          role="group"
          aria-label={S.subagentPanel.topologyLabel}
          tabIndex={0}
          onKeyDown={onCanvasKeyDown}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          style={{ height: canvasHeight, touchAction: "none" }}
          className={`relative select-none overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 outline-none focus-visible:border-gray-400 dark:border-gray-800 dark:bg-gray-900/40 dark:focus-visible:border-gray-600 ${
            panning ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: viewTransform(current),
            }}
          >
            {/* Edges only — nodes are HTML buttons layered above. */}
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0 text-gray-300 dark:text-gray-700"
              aria-hidden
            >
              {layout.edges.map((edge) => (
                <path
                  key={`${edge.fromId}>${edge.toId}`}
                  d={edge.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              ))}
            </svg>
            {layout.nodes.map(({ node, x, y }) => {
              const label = labelFor(node);
              const selected = node.sessionId === selectedId;
              const stateLabel = node.running
                ? S.subagentPanel.nodeRunning
                : S.subagentPanel.nodeDone;
              // The node renders the description truncated on its second line; the tooltip carries
              // the full sentence, which is the only place it appears untruncated.
              const tooltip =
                node.description !== null
                  ? `${label} · ${stateLabel}\n${node.description}`
                  : `${label} · ${stateLabel}`;
              return (
                <button
                  key={node.sessionId}
                  type="button"
                  aria-label={
                    node.depth === 0
                      ? `${label} · ${stateLabel}`
                      : `${label} · ${stateLabel} · ${node.sessionId}`
                  }
                  aria-pressed={selected}
                  data-tooltip={node.depth === 0 ? tooltip : `${tooltip}\n${node.sessionId}`}
                  onClick={() => onSelect(node)}
                  style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
                  className={`absolute flex flex-col justify-center gap-px rounded-md border bg-white px-2 text-left shadow-sm transition-colors duration-150 dark:bg-gray-900 ${
                    selected
                      ? "border-brand-500 ring-1 ring-brand-500"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800/60"
                  }`}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <AgentAvatar
                      id={node.agentId ?? node.sessionId}
                      size={18}
                      src={avatarFor(node)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                      {label}
                    </span>
                    {/* Elapsed: ticking from first appearance while running, frozen at the settled
                        span when done; omitted when the stamps are unknown (always for the root).
                        Decorative next to the label — the aria-label pins the accessible name. */}
                    {(node.running
                      ? node.startedMs !== undefined
                      : node.elapsedMs !== undefined) && (
                      <DurationSlot
                        running={node.running}
                        sinceMs={node.startedMs}
                        durationMs={node.elapsedMs}
                      />
                    )}
                    {/* Status is already part of the button's accessible name: keep the glyph decorative. */}
                    <StatusIcon state={node.running ? "running" : "done"} size="xs" />
                  </span>
                  {/* Second line: what this child was spawned to do. It sits a rung below the
                      name (small under body), so the node reads as who first and what second — CJK
                      text on the name's own rung looks larger than a Latin name above it. Indented to
                      the label's own left edge (avatar width + gap) and truncated to one line — the
                      model writes a free-form sentence into a fixed-size box, and the full text is in
                      the tooltip. Nodes without one (the root, a standalone child, an omitted
                      description) drop the line and the single row centers itself in the box instead. */}
                  {node.description !== null && (
                    <span className="w-full truncate pl-[24px] text-xs leading-tight text-fg-subtle">
                      {node.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
