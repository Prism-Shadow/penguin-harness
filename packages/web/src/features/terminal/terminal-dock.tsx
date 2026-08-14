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
  paneOfTerminal,
  paneRatio,
  resetPaneRatio,
  setPaneCurrent,
  setPaneRatio,
  subscribeTerminalDock,
  type DockPosition,
} from "./terminal-dock-state";
import { DockLayoutOverlay, dockDropCandidate } from "./terminal-dock-layout";
import { fetchJson, type TerminalInfo } from "./terminal-view";
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
      className={`group flex max-w-40 shrink-0 items-center rounded-md transition-colors duration-150 ${
        active
          ? "bg-white/15 text-white"
          : "text-white/50 hover:bg-white/10 hover:text-white/80"
      }`}
    >
      <button
        type="button"
        title={`${terminal.name} — ${terminal.cwd}`}
        onClick={props.onSelect}
        className="min-w-0 truncate py-0.5 pl-2 pr-1 text-left"
      >
        {label}
      </button>
      {/* Kill: this ends the shell itself (server-side), not just a view of it.
          Hover-revealed on every tab — an always-on × reads as a stray button (worst when
          the strip scrolls and only the ×'s sliver stays visible). */}
      <button
        type="button"
        title={S.terminal.killShell}
        aria-label={`${S.terminal.killShell}: ${label}`}
        data-testid="terminal-tab-kill"
        onClick={props.onKill}
        className="mr-1 rounded p-0.5 opacity-0 transition-opacity duration-150 hover:bg-white/20 group-hover:opacity-70 [&:hover]:opacity-100"
      >
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden>
          <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Creates a fresh shell assigned to (and shown in) the given pane. */
async function createShellInPane(position: DockPosition): Promise<void> {
  const created = await fetchJson<TerminalInfo>("/api/terminals", {
    method: "POST",
    body: JSON.stringify({ cwd: DOCK_CWD }),
  }).catch(() => null);
  if (!created) return;
  noteTerminalCreated(created);
  assignTerminalToPane(created.id, position);
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
      const existing = await fetchJson<TerminalInfo>(
        `/api/terminals/${encodeURIComponent(storedId)}`,
      ).catch(() => null);
      if (existing?.alive) return;
    }
    const listed = await fetchJson<{ terminals: TerminalInfo[] }>("/api/terminals").catch(
      () => null,
    );
    const mine = (listed?.terminals ?? []).filter(
      (t) => t.alive && paneOfTerminal(t.id) === position,
    );
    const newest = mine.at(-1);
    if (newest) {
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
  const viewState = useSyncExternalStore(subscribeTerminalViewStates, () =>
    terminalViewState(currentId),
  );

  const paneTerminals = useMemo(
    () => allTerminals.filter((t) => paneOfTerminal(t.id) === position),
    // paneOfTerminal reads dock-state; dockStateVersion above re-renders us on any change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTerminals, position, dockStateVersion()],
  );

  // First show (and whenever the pane ends up with no shown terminal): resolve one.
  useEffect(() => {
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
  const headerDrag = useRef<{ x: number; y: number; started: boolean } | null>(null);
  const [headerDragState, setHeaderDragState] = useState<{
    active: boolean;
    candidate: DockPosition | null;
  }>({ active: false, candidate: null });

  const onHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, [data-testid='terminal-tab']")) return;
    headerDrag.current = { x: event.clientX, y: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const origin = headerDrag.current;
    if (!origin) return;
    if (!origin.started) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      origin.started = true;
    }
    setHeaderDragState({
      active: true,
      candidate: dockDropCandidate(event.clientX, event.clientY),
    });
  }, []);

  const onHeaderPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const origin = headerDrag.current;
      headerDrag.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (!origin?.started) return;
      const candidate = headerDragState.candidate;
      setHeaderDragState({ active: false, candidate: null });
      if (candidate && candidate !== position) movePane(position, candidate);
    },
    [headerDragState.candidate, position],
  );

  const onHeaderPointerCancel = useCallback(() => {
    headerDrag.current = null;
    setHeaderDragState({ active: false, candidate: null });
  }, []);

  // --------------------------------------------------- tab drag: reorder or move to a pane
  const tabDrag = useRef<{ id: string; startX: number; startY: number; started: boolean } | null>(
    null,
  );
  const [tabDragState, setTabDragState] = useState<{
    active: boolean;
    candidate: DockPosition | null;
  }>({ active: false, candidate: null });

  const onStripPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-testid='terminal-tab-kill']")) return;
    const tab = target.closest<HTMLElement>("[data-terminal-id]");
    if (!tab?.dataset.terminalId) return;
    tabDrag.current = {
      id: tab.dataset.terminalId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };
    // Capture immediately: a fast pull leaves the strip before any move event would have
    // bubbled through it. Captured, every move/up lands here — the tap case included,
    // resolved as a select on pointerup (capture retargets the browser click).
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onStripPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = tabDrag.current;
    if (!drag) return;
    if (!drag.started) {
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (moved < 6) return;
      drag.started = true;
    }

    // Out of the strip (with a little slack): the gesture becomes "move to an edge" — the
    // same overlay as moving a pane, with the landing preview showing the new layout.
    const strip = event.currentTarget.getBoundingClientRect();
    const outside = event.clientY < strip.top - 20 || event.clientY > strip.bottom + 20;
    if (outside) {
      setTabDragState({
        active: true,
        candidate: dockDropCandidate(event.clientX, event.clientY),
      });
      return;
    }
    setTabDragState({ active: false, candidate: null });

    const tabEls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-terminal-id]"),
    ];
    const currentIds = tabEls.map((el) => el.dataset.terminalId as string);
    const others = tabEls.filter((el) => el.dataset.terminalId !== drag.id);
    let insertAt = others.length;
    for (let i = 0; i < others.length; i += 1) {
      const rect = others[i]!.getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) {
        insertAt = i;
        break;
      }
    }
    const nextIds = others.map((el) => el.dataset.terminalId as string);
    nextIds.splice(insertAt, 0, drag.id);
    if (nextIds.some((id, index) => id !== currentIds[index])) setTerminalTabOrder(nextIds);
  }, []);

  const onStripPointerUp = useCallback(() => {
    const drag = tabDrag.current;
    tabDrag.current = null;
    const { active, candidate } = tabDragState;
    setTabDragState({ active: false, candidate: null });
    if (drag && !drag.started) {
      selectTerminal(drag.id);
      return;
    }
    if (!drag?.started || !active || !candidate || candidate === position) return;
    // Move the dragged terminal to the chosen edge (creating that pane on demand) and
    // keep this pane on its next terminal — or close it when that was the last one.
    const remaining = paneTerminals.filter((t) => t.id !== drag.id);
    assignTerminalToPane(drag.id, candidate);
    if (paneCurrent(position) === drag.id || remaining.length === 0) {
      if (remaining.length > 0) setPaneCurrent(position, remaining.at(-1)!.id);
      else closePane(position);
    }
  }, [paneTerminals, position, selectTerminal, tabDragState]);

  // ------------------------------------------------------------------------ boundary resize
  const [resizing, setResizing] = useState(false);

  const onResizerPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }, []);

  const onResizerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!resizing) return;
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
    [position, resizing],
  );

  const onResizerPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizing(false);
  }, []);

  const onResizerDoubleClick = useCallback(() => resetPaneRatio(position), [position]);

  // ------------------------------------------------------------------------------- render
  const horizontal = isHorizontal(position);
  const ratio = paneRatio(position);
  const status = viewState.status;
  const detail = viewState.detail;
  // The dot alone carries the status (colour-coded); words live in its tooltip only.
  const statusTitle =
    status === "exited" && detail
      ? `${S.terminal.status.exited} — ${S.terminal.exitedWithCode(detail)}`
      : `${S.terminal.status[status]}${status === "error" && detail ? ` — ${detail}` : ""}`;

  const overlayActive = headerDragState.active || tabDragState.active;
  const overlayCandidate = headerDragState.active
    ? headerDragState.candidate
    : tabDragState.candidate;

  return (
    <div
      data-testid="terminal-dock"
      data-position={position}
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
        onPointerDown={onResizerPointerDown}
        onPointerMove={onResizerPointerMove}
        onPointerUp={onResizerPointerUp}
        onPointerCancel={onResizerPointerUp}
        onDoubleClick={onResizerDoubleClick}
        className={`absolute z-20 transition-colors duration-150 ${RESIZER_CLASSES[position]} ${
          resizing ? "bg-sky-500/60" : "bg-transparent hover:bg-sky-500/40"
        }`}
      />

      <header
        data-testid="terminal-dock-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerCancel}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs"
      >
        {/* Grip: the visual "this bar drags" affordance (any non-interactive spot of the
            header drags the pane; the grip is the always-present, unmistakable one). */}
        <span
          data-testid="terminal-dock-grip"
          aria-hidden
          className="shrink-0 text-white/30"
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
            the header — which is why the new-tab button lives OUTSIDE it. */}
        <div
          ref={stripRef}
          data-testid="terminal-tab-strip"
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={onStripPointerUp}
          onPointerCancel={onStripPointerUp}
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
        <DockButton
          label={S.terminal.newShell}
          testId="terminal-dock-new-shell"
          onClick={newShell}
          d="M12 5v14M5 12h14"
        />
        <span className="min-w-0 flex-1" />

        <span
          data-testid="terminal-dock-status"
          data-status={status}
          title={statusTitle}
          aria-label={statusTitle}
          className={`shrink-0 ${
            status === "ready"
              ? "text-emerald-400"
              : status === "connecting"
                ? "text-amber-400"
                : "text-red-400"
          }`}
        >
          ●
        </span>
        {/* Divider keeps the passive dot from blending into the action buttons. */}
        <span aria-hidden className="h-3.5 w-px shrink-0 bg-white/10" />
        <div className="flex shrink-0 items-center gap-1">
          {/* Detach: box with an arrow escaping to the top right */}
          <DockButton
            label={S.terminal.detach}
            testId="terminal-dock-detach"
            onClick={detach}
            d="M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
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

      {overlayActive && <DockLayoutOverlay candidate={overlayCandidate} />}
    </div>
  );
}
