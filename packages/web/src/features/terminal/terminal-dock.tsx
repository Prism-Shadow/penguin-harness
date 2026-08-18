/**
 * One dock pane: a terminal panel on one edge of the content area (terminal-dock-state.ts
 * owns which edges have panes). AppLayout renders a pane per open edge; the terminal
 * views themselves live in the shared pool (terminal-view-pool.tsx) and are adopted into
 * this pane's body by DOM handoff, so nothing about a pane's own lifecycle ever remounts
 * an xterm or drops its stream.
 *
 * The header carries the pane's tab strip (the terminals assigned to this pane), a "+" to
 * open another shell here, the current shell's status, detach-to-window and close. Tabs
 * drag sideways to reorder; dragging a tab OUT of the strip brings up the edge overlay
 * (bands + drop targets + landing preview) and dropping on another edge moves that
 * terminal there — creating the pane if needed. Dragging the header itself moves the
 * whole pane the same way (merging into an existing pane on that edge). The boundary with
 * the main content resizes the pane (ratio-persisted; double-click resets).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import {
  assignTerminalToPane,
  closePane,
  dockStateVersion,
  DEFAULT_DOCK_HEIGHT_RATIO,
  DEFAULT_DOCK_WIDTH_RATIO,
  isHorizontal,
  isTerminalDockOpen,
  movePane,
  paneCurrent,
  paneError,
  paneOfTerminal,
  paneRatio,
  resetPaneRatio,
  setPaneCurrent,
  setPaneError,
  setPaneRatio,
  subscribeTerminalDock,
  type DockPosition,
} from "./terminal-dock-state";
import { DockLayoutOverlay, dockDropCandidate } from "./terminal-dock-layout";
import { HttpStatusError, fetchJson, probeJson, type TerminalInfo } from "./terminal-view";
import {
  killTerminal,
  liveTerminals,
  noteTerminalCreated,
  refreshTerminals,
  setTerminalTabOrder,
  subscribeTerminals,
} from "./terminal-list";
import {
  subscribeTerminalViewStates,
  terminalViewContainer,
  terminalViewState,
} from "./terminal-view-pool";

/** The dock always opens new shells in the home directory (project cwd can come later). */
const DOCK_CWD = "~";

export function useTerminalDockOpen(): boolean {
  return useSyncExternalStore(subscribeTerminalDock, isTerminalDockOpen);
}

/** Root sizing per position; sizes are inline ratios, clamps are CSS (px minimums must
 * equal the DOCK_MIN_*_PX constants the drag preview uses, at every font scale). */
const POSITION_CLASSES: Record<DockPosition, string> = {
  bottom: "w-full border-t min-h-[140px] max-h-[85%]",
  top: "w-full border-b min-h-[140px] max-h-[85%]",
  left: "border-r min-w-[320px] max-w-[85%]",
  right: "border-l min-w-[320px] max-w-[85%]",
};

/** Resize handle placement: a 6px strip straddling the pane's inner edge. */
const RESIZER_CLASSES: Record<DockPosition, string> = {
  bottom: "left-0 right-0 -top-[3px] h-1.5 cursor-ns-resize",
  top: "left-0 right-0 -bottom-[3px] h-1.5 cursor-ns-resize",
  left: "top-0 bottom-0 -right-[3px] w-1.5 cursor-ew-resize",
  right: "top-0 bottom-0 -left-[3px] w-1.5 cursor-ew-resize",
};

/** Small icon-sized header button shared by the pane's controls. */
function DockButton(props: { label: string; testId: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={props.d} />
      </svg>
    </button>
  );
}

/**
 * Shell titles usually open with a `user@host` marker (bash and zsh default title
 * strings). The host says nothing useful in a single-server UI and eats the tab's width,
 * so it is dropped at display time only — the stored title stays untouched.
 *
 * The host part must exclude `:` explicitly: in a spaceless title like
 * `user@host:~/work`, a greedy `\S+` would swallow the path along with the host and leave
 * nothing of the title at all.
 */
export function displayTitle(title: string | null | undefined): string {
  return (title ?? "")
    .trim()
    .replace(/^[^@\s]+@[^:\s]+:?\s*/, "")
    .trim();
}

/**
 * One tab in the strip: number + name/title + a kill ×. Two sibling buttons, not nested —
 * a button inside a button is invalid and unclickable.
 */
function TerminalTab(props: {
  terminal: TerminalInfo;
  /** Fallback numbering for servers without `seq`; position-based, so only a fallback. */
  index: number;
  active: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  const { terminal, active } = props;
  // The `1:`-style prefix (tmux convention) keeps identically-named/-titled tabs apart.
  // It is the terminal's STABLE seq, not its position: a dragged tab keeps its number, so
  // where it went stays visible.
  const label = `${terminal.seq ?? props.index + 1}: ${displayTitle(terminal.title) || terminal.name}`;
  return (
    <div
      data-testid="terminal-tab"
      data-terminal-id={terminal.id}
      data-active={active}
      className={`group relative flex h-6 min-w-10 max-w-40 items-center overflow-hidden rounded-md transition-colors duration-150 ${
        active ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/10 hover:text-white/80"
      }`}
    >
      {/* No shrink-0: crowded tabs squeeze browser-style down to min-w-10 — the label
          clips hard (no ellipsis) so at the floor only the "N:" number stays readable. */}
      <button
        type="button"
        title={`${terminal.name} — ${terminal.cwd}`}
        onClick={props.onSelect}
        className="flex h-full w-full min-w-0 items-center px-2 text-left"
      >
        <span className="block w-full overflow-hidden whitespace-nowrap">{label}</span>
      </button>
      {/* Kill: this ends the shell itself (server-side), not just a view of it. A
          hover-revealed OVERLAY (absolute, own backdrop), so it costs no width while tabs
          squeeze and never reflows the strip on hover. */}
      <button
        type="button"
        title={S.terminal.killShell}
        aria-label={`${S.terminal.killShell}: ${label}`}
        data-testid="terminal-tab-kill"
        onClick={props.onKill}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded bg-[#262b31] p-0.5 opacity-0 transition-opacity duration-150 hover:bg-white/20 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          aria-hidden
        >
          <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Creates a fresh shell assigned to (and shown in) the given pane. Failures surface in
 * the pane body (setPaneError) — a swallowed create leaves a blank panel that looks like
 * nothing happened, which is exactly how a server-side spawn failure used to present.
 */
async function createShellInPane(position: DockPosition): Promise<void> {
  try {
    const created = await fetchJson<TerminalInfo>("/api/terminals", {
      method: "POST",
      body: JSON.stringify({ cwd: DOCK_CWD }),
    });
    setPaneError(position, null);
    noteTerminalCreated(created);
    assignTerminalToPane(created.id, position);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A 404 here is not "this terminal is gone" — the endpoint itself is absent, which
    // means the server answering is older than the terminal API (the desktop shell also
    // attaches to an already-running server rather than starting its own).
    const detail =
      err instanceof HttpStatusError && err.status === 404
        ? `${message} — ${S.terminal.noTerminalApi}`
        : message;
    console.error(`[terminal] create failed (${position} pane):`, detail);
    setPaneError(position, detail);
  }
}

/**
 * Shared pointer-drag state machine for the pane's gestures (header move, tab drag,
 * boundary resize): capture on pointerdown so a fast pull can never escape the surface, a
 * movement threshold separating taps from drags, and latest-callback refs so `onEnd`
 * never sees stale state. Spread the returned props on the gesture's surface.
 */
function usePointerDrag<T>(options: {
  /** Resolves the drag payload from the initial event; null refuses the gesture. */
  begin: (event: React.PointerEvent<HTMLElement>) => T | null;
  /** px of movement that turns the press into a drag (0 = immediately). */
  threshold?: number;
  onMove?: (event: React.PointerEvent<HTMLElement>, payload: T) => void;
  /** Release: `dragged` distinguishes a completed drag from a plain tap. */
  onEnd?: (payload: T, dragged: boolean) => void;
  /** Abandoned gesture (pointercancel): clear visuals, apply nothing. */
  onCancel?: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<{ payload: T; x: number; y: number; started: boolean } | null>(null);

  return useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const payload = latest.current.begin(event);
        if (payload === null) return;
        state.current = { payload, x: event.clientX, y: event.clientY, started: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        const drag = state.current;
        if (!drag) return;
        if (!drag.started) {
          const threshold = latest.current.threshold ?? 5;
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < threshold) return;
          drag.started = true;
        }
        latest.current.onMove?.(event, drag.payload);
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
        const drag = state.current;
        state.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (drag) latest.current.onEnd?.(drag.payload, drag.started);
      },
      onPointerCancel: () => {
        state.current = null;
        latest.current.onCancel?.();
      },
    }),
    [],
  );
}

/** One resolution at a time per pane — mount effects can fire in quick succession. */
const resolving = new Set<DockPosition>();

/**
 * First-show resolution for a pane: keep its stored terminal when still alive, else the
 * newest live terminal assigned here, else create one. Runs only when the pane has no
 * usable current — a shell exiting later must NOT auto-respawn (the user sees the exit).
 */
async function resolvePaneCurrent(position: DockPosition): Promise<void> {
  if (resolving.has(position)) return;
  resolving.add(position);
  try {
    const storedId = paneCurrent(position);
    if (storedId) {
      const existing = await probeJson<TerminalInfo>(
        `/api/terminals/${encodeURIComponent(storedId)}`,
      ).catch(() => null);
      if (existing?.alive) {
        setPaneError(position, null);
        return;
      }
    }
    const listed = await fetchJson<{ terminals: TerminalInfo[] }>("/api/terminals").catch(
      () => null,
    );
    const mine = (listed?.terminals ?? []).filter(
      (t) => t.alive && paneOfTerminal(t.id) === position,
    );
    const newest = mine.at(-1);
    if (newest) {
      setPaneError(position, null);
      setPaneCurrent(position, newest.id);
      return;
    }
    await createShellInPane(position);
  } finally {
    resolving.delete(position);
    void refreshTerminals();
  }
}

export function TerminalDock({ position }: { position: DockPosition }) {
  useSyncExternalStore(subscribeTerminalDock, dockStateVersion);
  const allTerminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  const currentId = paneCurrent(position);
  const resolveError = paneError(position);
  const viewState = useSyncExternalStore(subscribeTerminalViewStates, () =>
    terminalViewState(currentId),
  );

  const paneTerminals = useMemo(
    () => allTerminals.filter((t) => paneOfTerminal(t.id) === position),
    // paneOfTerminal reads dock-state; dockStateVersion above re-renders us on any change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTerminals, position, dockStateVersion()],
  );

  // Mount: always resolve, even with a stored id — the stored terminal can be dead or
  // reaped (server restart), and resolvePaneCurrent is what validates it against the
  // server. Afterwards only an EMPTIED pane re-resolves: a shell exiting while shown must
  // keep showing its exit, never auto-respawn.
  const resolvedOnMount = useRef(false);
  useEffect(() => {
    if (!resolvedOnMount.current) {
      resolvedOnMount.current = true;
      void resolvePaneCurrent(position);
      return;
    }
    if (currentId === null) void resolvePaneCurrent(position);
  }, [currentId, position]);

  // The shown tab keeps itself in view: with many tabs the strip scrolls, and a
  // half-clipped active tab reads as a stray × button at the strip's edge.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (currentId === null) return;
    stripRef.current
      ?.querySelector(`[data-terminal-id="${CSS.escape(currentId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentId, paneTerminals]);

  // Wheel over the strip scrolls it sideways (there is no vertical axis to scroll, and a
  // trackpad's deltaX works too). Native non-passive listener: React's synthetic onWheel
  // is passive, so preventDefault there cannot stop the page handling the event.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent): void => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0 || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      strip.scrollLeft += delta;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // Adopt the shown terminal's pooled container into this pane's body.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || currentId === null) return;
    const container = terminalViewContainer(currentId);
    body.appendChild(container);
    return () => {
      if (container.parentElement === body) body.removeChild(container);
    };
  }, [currentId]);

  const selectTerminal = useCallback(
    (id: string) => {
      if (id !== paneCurrent(position)) setPaneCurrent(position, id);
    },
    [position],
  );

  /** Fresh shell in a new tab of this pane; the current one keeps running. */
  const newShell = useCallback(() => {
    void createShellInPane(position);
  }, [position]);

  /** Kills a tab's shell; killing the last one closes the pane (never auto-respawns). */
  const onKillTerminal = useCallback(
    (id: string) => {
      void killTerminal(id);
      const remaining = paneTerminals.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        closePane(position);
        return;
      }
      if (id === paneCurrent(position)) {
        setPaneCurrent(position, remaining.at(-1)!.id);
      }
    },
    [paneTerminals, position],
  );

  /**
   * Detach the shown terminal to its own /terminal window. The shell stays live (and
   * listed — multi-client attach); the pane moves on to its newest other terminal, or
   * closes when this was the only one.
   */
  const detach = useCallback(() => {
    const id = paneCurrent(position);
    if (!id) return;
    window.open(`/terminal?id=${encodeURIComponent(id)}`, "_blank", "noopener");
    const remaining = paneTerminals.filter((t) => t.id !== id);
    if (remaining.length > 0) setPaneCurrent(position, remaining.at(-1)!.id);
    else closePane(position);
  }, [paneTerminals, position]);

  // ------------------------------------------------------------------ header drag: move pane
  const [headerDragState, setHeaderDragState] = useState<{
    active: boolean;
    candidate: DockPosition | null;
  }>({ active: false, candidate: null });
  const clearHeaderDrag = () => setHeaderDragState({ active: false, candidate: null });

  const headerDragProps = usePointerDrag<object>({
    begin: (event) =>
      (event.target as HTMLElement).closest("button, [data-testid='terminal-tab']") ? null : {},
    onMove: (event) =>
      setHeaderDragState({
        active: true,
        candidate: dockDropCandidate(event.clientX, event.clientY),
      }),
    onEnd: (_payload, dragged) => {
      const candidate = headerDragState.candidate;
      clearHeaderDrag();
      if (dragged && candidate && candidate !== position)
        movePane(
          position,
          candidate,
          // The pane's live tabs: movePane cannot see implicit (unassigned-to-primary)
          // membership on its own — without this list those tabs would not move along.
          paneTerminals.map((t) => t.id),
        );
    },
    onCancel: clearHeaderDrag,
  });

  // --------------------------------------------------- tab drag: reorder or move to a pane
  const [tabDragState, setTabDragState] = useState<{
    active: boolean;
    candidate: DockPosition | null;
  }>({ active: false, candidate: null });
  const clearTabDrag = () => setTabDragState({ active: false, candidate: null });

  const stripDragProps = usePointerDrag<{ id: string }>({
    threshold: 6,
    begin: (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-testid='terminal-tab-kill']")) return null;
      const id = target.closest<HTMLElement>("[data-terminal-id]")?.dataset.terminalId;
      return id ? { id } : null;
    },
    onMove: (event, { id }) => {
      // Out of the strip (with a little slack): the gesture becomes "move to an edge" —
      // the same overlay as moving a pane, with the preview showing the new layout.
      const strip = event.currentTarget.getBoundingClientRect();
      if (event.clientY < strip.top - 20 || event.clientY > strip.bottom + 20) {
        setTabDragState({
          active: true,
          candidate: dockDropCandidate(event.clientX, event.clientY),
        });
        return;
      }
      setTabDragState({ active: false, candidate: null });

      // Within the strip: live reorder against the other tabs' midpoints.
      const tabEls = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-terminal-id]")];
      const currentIds = tabEls.map((el) => el.dataset.terminalId as string);
      const others = tabEls.filter((el) => el.dataset.terminalId !== id);
      let insertAt = others.length;
      for (let i = 0; i < others.length; i += 1) {
        const rect = others[i]!.getBoundingClientRect();
        if (event.clientX < rect.left + rect.width / 2) {
          insertAt = i;
          break;
        }
      }
      const nextIds = others.map((el) => el.dataset.terminalId as string);
      nextIds.splice(insertAt, 0, id);
      if (nextIds.some((nextId, index) => nextId !== currentIds[index]))
        setTerminalTabOrder(nextIds);
    },
    onEnd: ({ id }, dragged) => {
      const { active, candidate } = tabDragState;
      clearTabDrag();
      // A tap resolves to select here: pointer capture retargets the browser click to the
      // strip, so the tab's own click handler never fires from a mouse press.
      if (!dragged) {
        selectTerminal(id);
        return;
      }
      if (!active || !candidate || candidate === position) return;
      // Move the dragged terminal to the chosen edge (creating that pane on demand) and
      // keep this pane on its next terminal — or close it when that was the last one.
      const remaining = paneTerminals.filter((t) => t.id !== id);
      assignTerminalToPane(id, candidate);
      if (paneCurrent(position) === id || remaining.length === 0) {
        if (remaining.length > 0) setPaneCurrent(position, remaining.at(-1)!.id);
        else closePane(position);
      }
    },
    onCancel: clearTabDrag,
  });

  // ------------------------------------------------------------------------ boundary resize
  const [resizing, setResizing] = useState(false);

  const resizerDragProps = usePointerDrag<object>({
    threshold: 0,
    begin: (event) => {
      event.preventDefault(); // no text selection while dragging the boundary
      setResizing(true);
      return {};
    },
    onMove: (event) => {
      // The ratio's basis must match what the CSS percentage resolves against: the host
      // column for top/bottom panes (they are its direct children), whose width the
      // layout row shares for left/right. The pane's own rect anchors the far edge.
      const host = document.querySelector("[data-dock-host]")?.getBoundingClientRect();
      const pane = event.currentTarget
        .closest("[data-testid='terminal-dock']")
        ?.getBoundingClientRect();
      if (!host || !pane || host.width === 0 || host.height === 0) return;
      switch (position) {
        case "bottom":
          setPaneRatio(position, (pane.bottom - event.clientY) / host.height);
          break;
        case "top":
          setPaneRatio(position, (event.clientY - pane.top) / host.height);
          break;
        case "left":
          setPaneRatio(position, (event.clientX - pane.left) / host.width);
          break;
        case "right":
          setPaneRatio(position, (pane.right - event.clientX) / host.width);
          break;
      }
    },
    onEnd: () => setResizing(false),
    onCancel: () => setResizing(false),
  });

  const onResizerDoubleClick = useCallback(() => resetPaneRatio(position), [position]);

  // ------------------------------------------------------------------------------- render
  const horizontal = isHorizontal(position);
  const ratio = paneRatio(position);
  // No visible status indicator (the screen itself shows what the shell is doing); the
  // machine-readable state stays on the root as data-status for tests and tooling.
  const status = viewState.status;

  const overlayActive = headerDragState.active || tabDragState.active;
  const overlayCandidate = headerDragState.active
    ? headerDragState.candidate
    : tabDragState.candidate;

  return (
    <div
      data-testid="terminal-dock"
      data-position={position}
      data-status={status}
      style={horizontal ? { height: `${ratio * 100}%` } : { width: `${ratio * 100}%` }}
      className={`relative flex min-h-0 min-w-0 flex-col border-gray-200 bg-[#14171a] text-[#e6e6e6] dark:border-gray-800 ${POSITION_CLASSES[position]}`}
    >
      {/* Boundary resize handle: invisible until hovered/active, forgiving 6px hit strip. */}
      <div
        data-testid="terminal-dock-resizer"
        role="separator"
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        aria-label={S.terminal.resize}
        title={S.terminal.resize}
        {...resizerDragProps}
        onDoubleClick={onResizerDoubleClick}
        className={`absolute z-20 transition-colors duration-150 ${RESIZER_CLASSES[position]} ${
          resizing ? "bg-sky-500/60" : "bg-transparent hover:bg-sky-500/40"
        }`}
      />

      <header
        data-testid="terminal-dock-header"
        {...headerDragProps}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs"
      >
        {/* Grip: the visual "this bar drags" affordance (any non-interactive spot of the
            header drags the pane; the grip is the always-present, unmistakable one). */}
        <span
          data-testid="terminal-dock-grip"
          aria-hidden
          className="flex h-6 shrink-0 items-center text-white/30"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2.5" r="1.2" />
            <circle cx="7.5" cy="2.5" r="1.2" />
            <circle cx="2.5" cy="7" r="1.2" />
            <circle cx="7.5" cy="7" r="1.2" />
            <circle cx="2.5" cy="11.5" r="1.2" />
            <circle cx="7.5" cy="11.5" r="1.2" />
          </svg>
        </span>

        {/* Tab strip: this pane's terminals, current one highlighted; drag sideways to
            reorder, drag out to move onto another edge. Scrolls when the shells outgrow
            the header. */}
        <div
          ref={stripRef}
          data-testid="terminal-tab-strip"
          {...stripDragProps}
          className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {paneTerminals.map((terminal, index) => (
            <TerminalTab
              key={terminal.id}
              terminal={terminal}
              index={index}
              active={terminal.id === currentId}
              onSelect={() => selectTerminal(terminal.id)}
              onKill={() => onKillTerminal(terminal.id)}
            />
          ))}
        </div>
        <span className="min-w-0 flex-1" />

        {/* Right-hand action cluster with uniform spacing, ending in close. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Detach: box with an arrow escaping to the top right */}
          <DockButton
            label={S.terminal.detach}
            testId="terminal-dock-detach"
            onClick={detach}
            d="M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
          />
          {/* New shell: plus, beside close per the product spec. */}
          <DockButton
            label={S.terminal.newShell}
            testId="terminal-dock-new-shell"
            onClick={newShell}
            d="M12 5v14M5 12h14"
          />
          {/* Close pane: X (its shells keep running; they fold into the primary pane) */}
          <DockButton
            label={S.terminal.close}
            testId="terminal-dock-close"
            onClick={() => closePane(position)}
            d="M6 6l12 12M18 6L6 18"
          />
        </div>
      </header>

      {/* The shown terminal's pooled view is adopted here (see the body effect). */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1" />
      {/* Resolution/creation failure: say so instead of sitting blank. The server's error
          message is shown verbatim (e.g. terminal_spawn_failed with the spawn error). */}
      {currentId === null && resolveError !== null && (
        <div
          data-testid="terminal-dock-error"
          className="absolute inset-x-0 bottom-0 top-9 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <div className="text-sm text-red-400">{S.terminal.createFailed}</div>
          <div className="max-w-xl break-all text-xs text-white/50">{resolveError}</div>
          <button
            type="button"
            data-testid="terminal-dock-retry"
            onClick={() => {
              setPaneError(position, null);
              void resolvePaneCurrent(position);
            }}
            className="rounded border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
          >
            {S.common.retry}
          </button>
        </div>
      )}

      {overlayActive && <DockLayoutOverlay candidate={overlayCandidate} />}
    </div>
  );
}
