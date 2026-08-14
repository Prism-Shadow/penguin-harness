/**
 * In-app terminal dock (Codex-style integrated terminal): a panel across the bottom of the
 * main content column, toggled by Ctrl+` or the sidebar's terminal entry, present on every
 * page because it mounts in AppLayout.
 *
 * The header carries a tab strip of every live terminal the user has — created anywhere:
 * this dock, the /terminal page, a detached window, the API — so terminals can be seen,
 * switched between, and closed (the × kills the shell), not just added. The strip renders
 * the shared terminal-list store; the badge in the chat toolbar shows the same list's size.
 *
 * The shell is the same server-side terminal the standalone page uses, and opening the
 * dock always lands on a live shell (the persistence rules):
 * - the terminal opened last time (stored id) when it is still alive;
 * - otherwise the newest of the user's live terminals;
 * - otherwise a fresh shell is created (and kept: closing the dock only hides the view).
 * "Detach" opens `/terminal?id=<id>` in its own window; the stored id is kept, so
 * reopening the dock shows that same shell again (multi-client attach).
 * A reload restores both the dock (open state persists) and the shell (id persists).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { S } from "../../lib/strings";
import {
  DEFAULT_DOCK_HEIGHT_RATIO,
  DEFAULT_DOCK_WIDTH_RATIO,
  isTerminalDockOpen,
  setTerminalDockHeightRatio,
  setTerminalDockOpen,
  setTerminalDockPosition,
  setTerminalDockWidthRatio,
  subscribeTerminalDock,
  terminalDockHeightRatio,
  terminalDockPosition,
  terminalDockWidthRatio,
  toggleTerminalDock,
  type DockPosition,
} from "./terminal-dock-state";
import { DockLayoutOverlay, dockDropCandidate } from "./terminal-dock-layout";
import {
  TerminalView,
  fetchJson,
  type TerminalInfo,
  type TerminalStatus,
} from "./terminal-view";
import {
  killTerminal,
  liveTerminals,
  noteTerminalCreated,
  noteTerminalTitle,
  refreshTerminals,
  setTerminalTabOrder,
  subscribeTerminals,
} from "./terminal-list";

const DOCK_ID_KEY = "penguin.terminal.dock.id";
/** The dock always opens in the home directory (project-scoped cwd can come later). */
const DOCK_CWD = "~";

export function useTerminalDockOpen(): boolean {
  return useSyncExternalStore(subscribeTerminalDock, isTerminalDockOpen);
}

/** Which edge of the content area the dock occupies — AppLayout picks the slot from this. */
export function useTerminalDockPosition(): DockPosition {
  return useSyncExternalStore(subscribeTerminalDock, terminalDockPosition);
}

/**
 * Root placement + flex order per position; the internal header+view column is the same
 * everywhere. `order` (against the layout row's main, order-2) is what moves the dock —
 * the component itself never changes its place in the React tree, so repositioning never
 * remounts it and the terminal connection survives the move untouched. The size itself is
 * a ratio of the layout row (inline percentage style), clamped by the min/max classes so
 * neither the dock nor the main content can be crushed away.
 */
const POSITION_CLASSES: Record<DockPosition, string> = {
  // px minimums on purpose (not the rem spacing scale): they must equal the
  // DOCK_MIN_*_PX constants the drag preview clamps with, at every font scale.
  bottom: "order-3 w-full border-t min-h-[140px] max-h-[85%]",
  top: "order-1 w-full border-b min-h-[140px] max-h-[85%]",
  left: "order-1 border-r min-w-[320px] max-w-[85%]",
  right: "order-3 border-l min-w-[320px] max-w-[85%]",
};

/**
 * Resize handle placement: a 6px strip straddling the dock's inner edge (the boundary
 * with the main content), so the grab target is forgiving on both sides of the line.
 */
const RESIZER_CLASSES: Record<DockPosition, string> = {
  bottom: "left-0 right-0 -top-[3px] h-1.5 cursor-ns-resize",
  top: "left-0 right-0 -bottom-[3px] h-1.5 cursor-ns-resize",
  left: "top-0 bottom-0 -right-[3px] w-1.5 cursor-ew-resize",
  right: "top-0 bottom-0 -left-[3px] w-1.5 cursor-ew-resize",
};

/**
 * Resolves the terminal the dock should show: last opened (stored id) if still alive, else
 * the newest live terminal from anywhere, else a fresh one. Only the last case creates —
 * unless `forceCreate` ("New shell"), which skips the reattach paths entirely (they would
 * otherwise just hand back the shell the user asked to leave).
 */
async function ensureDockTerminal(
  cols: number,
  rows: number,
  forceCreate: boolean,
): Promise<TerminalInfo> {
  if (!forceCreate) {
    const storedId = localStorage.getItem(DOCK_ID_KEY);
    if (storedId) {
      const existing = await fetchJson<TerminalInfo>(`/api/terminals/${storedId}`).catch(
        () => null,
      );
      if (existing?.alive) return existing;
    }

    // No usable stored id: fall back to the newest live terminal (the list is ordered by
    // createdAt ascending), wherever it was opened from.
    const listed = await fetchJson<{ terminals: TerminalInfo[] }>("/api/terminals").catch(
      () => null,
    );
    const alive = (listed?.terminals ?? []).filter((t) => t.alive);
    const latest = alive.at(-1);
    if (latest) {
      localStorage.setItem(DOCK_ID_KEY, latest.id);
      return latest;
    }
  }

  const created = await fetchJson<TerminalInfo>("/api/terminals", {
    method: "POST",
    body: JSON.stringify({ cwd: DOCK_CWD, cols, rows }),
  });
  if (!created) throw new Error("Server did not return a terminal.");
  localStorage.setItem(DOCK_ID_KEY, created.id);
  // Straight into the shared list: the tab strip and count react to the user's create
  // immediately instead of after the next reconciling fetch.
  noteTerminalCreated(created);
  return created;
}

/** Small icon-sized header button shared by the dock's controls. */
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
 * One tab in the strip: name (title once the shell sets one) + a kill ×. Two sibling
 * buttons, not nested — a button inside a button is invalid and unclickable.
 */
function TerminalTab(props: {
  terminal: TerminalInfo;
  /** Position in the strip; shown as a `1:`-style prefix (tmux convention) so tabs stay
   * distinguishable even when several shells share a name or an identical OSC title. */
  index: number;
  active: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  const { terminal, active } = props;
  const label = `${props.index + 1}: ${terminal.title?.trim() || terminal.name}`;
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
      {/* Kill: this ends the shell itself (server-side), not just a view of it. */}
      <button
        type="button"
        title={S.terminal.killShell}
        aria-label={`${S.terminal.killShell}: ${label}`}
        data-testid="terminal-tab-kill"
        onClick={props.onKill}
        className={`mr-1 rounded p-0.5 transition-opacity duration-150 hover:bg-white/20 ${
          active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70"
        }`}
      >
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden>
          <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function TerminalDock() {
  const open = useTerminalDockOpen();
  const position = useTerminalDockPosition();
  const heightRatio = useSyncExternalStore(subscribeTerminalDock, terminalDockHeightRatio);
  const widthRatio = useSyncExternalStore(subscribeTerminalDock, terminalDockWidthRatio);
  const [resizing, setResizing] = useState(false);
  const terminals = useSyncExternalStore(subscribeTerminals, liveTerminals);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [detail, setDetail] = useState("");
  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [generation, setGeneration] = useState(0);
  /** Armed by "New shell" for exactly the next attach; consumed inside ensure. */
  const forceCreateRef = useRef(false);
  /** Header drag-to-dock: origin until the threshold, then the live drop candidate. */
  const dragOrigin = useRef<{ x: number; y: number; started: boolean } | null>(null);
  const [drag, setDrag] = useState<{ active: boolean; candidate: DockPosition | null }>({
    active: false,
    candidate: null,
  });

  const ensure = useCallback(async (cols: number, rows: number): Promise<TerminalInfo> => {
    const forceCreate = forceCreateRef.current;
    forceCreateRef.current = false;
    return ensureDockTerminal(cols, rows, forceCreate);
  }, []);

  // Ctrl+` toggles the dock from anywhere in the app (the Codex/VS Code binding). Bound
  // here so it exists exactly once, dock visible or not.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key !== "`" && event.code !== "Backquote") return;
      event.preventDefault();
      toggleTerminalDock();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // An opening dock re-reads the tab strip: terminals may have been opened or closed from
  // other surfaces while it was hidden.
  useEffect(() => {
    if (open) void refreshTerminals();
  }, [open]);

  /** Remounts the view onto another terminal (or a to-be-created one when id is null). */
  const switchTo = useCallback((id: string | null) => {
    if (id === null) localStorage.removeItem(DOCK_ID_KEY);
    else localStorage.setItem(DOCK_ID_KEY, id);
    setStatus("connecting");
    setDetail("");
    setInfo(null);
    setGeneration((n) => n + 1);
  }, []);

  const onStatus = useCallback((next: TerminalStatus, statusDetail: string) => {
    setStatus(next);
    setDetail(statusDetail);
    // A shell exiting under the dock changes the tab strip and the toolbar badge.
    if (next === "exited") void refreshTerminals();
  }, []);

  const onInfo = useCallback((next: TerminalInfo) => {
    setInfo(next);
    // Attaching may have created a terminal; either way the strip/badge re-sync.
    void refreshTerminals();
  }, []);

  /** Live OSC title from the attached shell → the shared list → this tab's label. */
  const onTitle = useCallback(
    (title: string) => {
      if (info) noteTerminalTitle(info.id, title);
    },
    [info],
  );

  /** Fresh shell in a new tab; the current one keeps running. */
  const newShell = useCallback(() => {
    forceCreateRef.current = true;
    switchTo(null);
  }, [switchTo]);

  const selectTerminal = useCallback(
    (id: string) => {
      if (id !== info?.id) switchTo(id);
    },
    [info, switchTo],
  );

  /** Kills the shell behind a tab; killing the current tab moves to the newest remaining. */
  const onKillTerminal = useCallback(
    (id: string) => {
      void killTerminal(id);
      if (id !== info?.id && info !== null) return; // a background tab: the strip just updates
      // The killed shell can still report alive for a moment (SIGHUP is async), so the
      // reattach fallback must not run — target the survivor explicitly.
      const remaining = terminals.filter((t) => t.id !== id);
      const survivor = remaining.at(-1);
      if (survivor) {
        switchTo(survivor.id);
      } else {
        // Killing the LAST terminal means "I'm done" — close the dock instead of spawning
        // a replacement nobody asked for. Reopening creates afresh (the persistence rules).
        localStorage.removeItem(DOCK_ID_KEY);
        setTerminalDockOpen(false);
      }
    },
    [info, switchTo, terminals],
  );

  /**
   * Codex-style detach of one terminal into its own window. With other terminals open the
   * dock stays — detaching the current tab moves it to the newest remaining one; only
   * detaching the last terminal closes the dock. The detached shell stays in the tab
   * strip (it is still a live terminal; the stream supports multiple attached clients).
   */
  const detachTerminal = useCallback(
    (id: string) => {
      window.open(`/terminal?id=${encodeURIComponent(id)}`, "_blank", "noopener");
      if (id !== info?.id && info !== null) return; // a background tab: nothing to switch
      const next = terminals.filter((t) => t.id !== id).at(-1);
      if (next) {
        switchTo(next.id);
      } else {
        localStorage.removeItem(DOCK_ID_KEY);
        setTerminalDockOpen(false);
      }
    },
    [info, switchTo, terminals],
  );

  /** The header's detach button: detaches whatever terminal is currently shown. */
  const detach = useCallback(() => {
    const id = info?.id ?? localStorage.getItem(DOCK_ID_KEY);
    if (id) detachTerminal(id);
  }, [detachTerminal, info]);

  /**
   * Tab dragging, delegated on the strip. Two gestures share one drag:
   * - sideways within the strip: reorder — the pointer's x against the other tabs'
   *   midpoints re-inserts the dragged id and the order persists live;
   * - pulled OUT of the strip (vertically past a slack band): detach — a floating hint
   *   follows the pointer, and releasing opens that terminal in its own window.
   * A press that never crosses the threshold stays a plain click (the tab's own select
   * handler).
   */
  const tabDrag = useRef<{ id: string; startX: number; startY: number; started: boolean } | null>(
    null,
  );
  const [dragOut, setDragOut] = useState<{ x: number; y: number } | null>(null);

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
    // bubbled through it, and the drag would never see the pointer again. Captured, every
    // move/up lands here — including the tap case, resolved as a select on pointerup.
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

    // Out of the strip (with a little slack): the gesture becomes detach, not reorder.
    const strip = event.currentTarget.getBoundingClientRect();
    const outside = event.clientY < strip.top - 20 || event.clientY > strip.bottom + 20;
    if (outside) {
      setDragOut({ x: event.clientX, y: event.clientY });
      return;
    }
    setDragOut(null);

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
    // Pointer capture retargets the browser's click to the strip, so the tab's own click
    // handler never fires from a mouse press — the tap resolves here instead.
    if (drag && !drag.started) selectTerminal(drag.id);
    if (drag?.started && dragOut) detachTerminal(drag.id);
    setDragOut(null);
  }, [detachTerminal, dragOut, selectTerminal]);

  /**
   * Header drag-to-dock. Buttons and tabs keep their own gestures; a drag starts from any
   * other point of the header once the pointer moves past a small threshold, and pointer
   * capture keeps the move/up events coming even while the pointer crosses the overlay.
   */
  const onHeaderPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, [data-testid='terminal-tab']")) return;
    dragOrigin.current = { x: event.clientX, y: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onHeaderPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    if (!origin.started) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      origin.started = true;
    }
    setDrag({ active: true, candidate: dockDropCandidate(event.clientX, event.clientY) });
  }, []);

  const onHeaderPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const origin = dragOrigin.current;
      dragOrigin.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (!origin?.started) return;
      const candidate = drag.candidate;
      setDrag({ active: false, candidate: null });
      // Applying remounts the dock in its new slot; the view reattaches and the server's
      // restore stream repaints the screen, so the shell itself never notices the move.
      if (candidate) setTerminalDockPosition(candidate);
    },
    [drag.candidate],
  );

  const onHeaderPointerCancel = useCallback(() => {
    dragOrigin.current = null;
    setDrag({ active: false, candidate: null });
  }, []);

  /**
   * Boundary resize: the pointer's distance from the row's opposite edge becomes the new
   * ratio, applied live (the ratio store re-renders the percentage size; xterm refits via
   * its ResizeObserver — the same path as a window resize, so nothing reconnects).
   */
  const onResizerPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }, []);

  const onResizerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!resizing) return;
      const row = document.querySelector("[data-dock-row]")?.getBoundingClientRect();
      if (!row || row.width === 0 || row.height === 0) return;
      switch (position) {
        case "bottom":
          setTerminalDockHeightRatio((row.bottom - event.clientY) / row.height);
          break;
        case "top":
          setTerminalDockHeightRatio((event.clientY - row.top) / row.height);
          break;
        case "left":
          setTerminalDockWidthRatio((event.clientX - row.left) / row.width);
          break;
        case "right":
          setTerminalDockWidthRatio((row.right - event.clientX) / row.width);
          break;
      }
    },
    [position, resizing],
  );

  const onResizerPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizing(false);
  }, []);

  /** Double-click the boundary: back to the default size for this orientation. */
  const onResizerDoubleClick = useCallback(() => {
    if (position === "top" || position === "bottom") {
      setTerminalDockHeightRatio(DEFAULT_DOCK_HEIGHT_RATIO);
    } else {
      setTerminalDockWidthRatio(DEFAULT_DOCK_WIDTH_RATIO);
    }
  }, [position]);

  if (!open) return null;

  const statusText =
    status === "exited" && detail
      ? `${S.terminal.status.exited} — ${S.terminal.exitedWithCode(detail)}`
      : `${S.terminal.status[status]}${status === "error" && detail ? ` — ${detail}` : ""}`;

  const horizontal = position === "top" || position === "bottom";

  return (
    <div
      data-testid="terminal-dock"
      data-position={position}
      style={horizontal ? { height: `${heightRatio * 100}%` } : { width: `${widthRatio * 100}%` }}
      className={`relative flex shrink-0 flex-col border-gray-200 bg-[#14171a] text-[#e6e6e6] dark:border-gray-800 ${POSITION_CLASSES[position]}`}
    >
      {/* Boundary resize handle: invisible until hovered/active, forgiving 6px hit strip.
          role=separator for assistive tech; double-click restores the default size. */}
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
        <span className="shrink-0 font-medium">{S.terminal.title}</span>

        {/* Tab strip: every live terminal, current one highlighted, drag sideways to
            reorder. Scrolls when the shells outgrow the header — which is why the new-tab
            button lives OUTSIDE it: "+" must never scroll out of reach. */}
        <div
          data-testid="terminal-tab-strip"
          onPointerDown={onStripPointerDown}
          onPointerMove={onStripPointerMove}
          onPointerUp={onStripPointerUp}
          onPointerCancel={onStripPointerUp}
          className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
        >
          {terminals.map((terminal, index) => (
            <TerminalTab
              key={terminal.id}
              terminal={terminal}
              index={index}
              active={terminal.id === info?.id}
              onSelect={() => selectTerminal(terminal.id)}
              onKill={() => onKillTerminal(terminal.id)}
            />
          ))}
        </div>
        {/* New shell: plus, pinned right after the strip like a browser's new-tab button. */}
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
          className={`shrink-0 ${
            status === "ready"
              ? "text-emerald-400"
              : status === "connecting"
                ? "text-amber-400"
                : "text-red-400"
          }`}
        >
          ● {statusText}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {/* Detach: box with an arrow escaping to the top right */}
          <DockButton
            label={S.terminal.detach}
            testId="terminal-dock-detach"
            onClick={detach}
            d="M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
          />
          {/* Close: X (hides the dock; the shells keep running server-side) */}
          <DockButton
            label={S.terminal.close}
            testId="terminal-dock-close"
            onClick={() => setTerminalDockOpen(false)}
            d="M6 6l12 12M18 6L6 18"
          />
        </div>
      </header>
      <TerminalView
        key={generation}
        ensure={ensure}
        onStatus={onStatus}
        onInfo={onInfo}
        onTitle={onTitle}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
      {drag.active && <DockLayoutOverlay candidate={drag.candidate} />}
      {/* Floating hint while a tab is dragged out of the strip: release = own window. */}
      {dragOut &&
        createPortal(
          <div
            data-testid="tab-detach-hint"
            aria-hidden
            className="pointer-events-none fixed z-[70] rounded-md border border-white/20 bg-gray-900/95 px-2 py-1 text-xs text-white shadow-lg"
            style={{ left: dragOut.x + 12, top: dragOut.y + 12 }}
          >
            {S.terminal.dragOutHint}
          </div>,
          document.body,
        )}
    </div>
  );
}
