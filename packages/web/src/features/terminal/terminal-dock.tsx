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
import { S } from "../../lib/strings";
import {
  isTerminalDockOpen,
  setTerminalDockOpen,
  setTerminalDockPosition,
  subscribeTerminalDock,
  terminalDockPosition,
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
  refreshTerminals,
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

/** Root sizing per position; the internal header+view column is the same everywhere. */
const POSITION_CLASSES: Record<DockPosition, string> = {
  bottom: "h-72 w-full border-t",
  top: "h-72 w-full border-b",
  left: "w-[26rem] border-r",
  right: "w-[26rem] border-l",
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
  active: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  const { terminal, active } = props;
  const label = terminal.title?.trim() || terminal.name;
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
      // reattach fallback must not run — target the survivor explicitly, or force-create.
      const remaining = terminals.filter((t) => t.id !== id);
      const survivor = remaining.at(-1);
      if (survivor) {
        switchTo(survivor.id);
      } else {
        forceCreateRef.current = true;
        switchTo(null);
      }
    },
    [info, switchTo, terminals],
  );

  /**
   * Codex-style detach: hand the terminal to its own window. The stored id is kept — it is
   * still the last-opened terminal, so reopening the dock shows this same shell (the
   * stream supports multiple attached clients).
   */
  const detach = useCallback(() => {
    const id = info?.id ?? localStorage.getItem(DOCK_ID_KEY);
    if (!id) return;
    window.open(`/terminal?id=${encodeURIComponent(id)}`, "_blank", "noopener");
    setTerminalDockOpen(false);
  }, [info]);

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

  if (!open) return null;

  const statusText =
    status === "exited" && detail
      ? `${S.terminal.status.exited} — ${S.terminal.exitedWithCode(detail)}`
      : `${S.terminal.status[status]}${status === "error" && detail ? ` — ${detail}` : ""}`;

  return (
    <div
      data-testid="terminal-dock"
      data-position={position}
      className={`flex shrink-0 flex-col border-gray-200 bg-[#14171a] text-[#e6e6e6] dark:border-gray-800 ${POSITION_CLASSES[position]}`}
    >
      <header
        data-testid="terminal-dock-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerCancel}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs"
      >
        <span className="shrink-0 font-medium">{S.terminal.title}</span>

        {/* Tab strip: every live terminal, current one highlighted. Scrolls sideways when
            the shells outgrow the header; the controls at both ends stay put. */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {terminals.map((terminal) => (
            <TerminalTab
              key={terminal.id}
              terminal={terminal}
              active={terminal.id === info?.id}
              onSelect={() => selectTerminal(terminal.id)}
              onKill={() => onKillTerminal(terminal.id)}
            />
          ))}
          {/* New shell: plus, at the end of the strip like a browser's new-tab button. */}
          <DockButton
            label={S.terminal.newShell}
            testId="terminal-dock-new-shell"
            onClick={newShell}
            d="M12 5v14M5 12h14"
          />
        </div>

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
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
      {drag.active && <DockLayoutOverlay candidate={drag.candidate} />}
    </div>
  );
}
