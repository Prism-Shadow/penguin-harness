/**
 * Subagents panel state machine (cloned from use-files-panel.ts, which documents the shared
 * mechanics in detail): panel open/close, drag-to-resize with its own persisted width key, the
 * desktop-dock vs. mobile-Sheet breakpoint, the "focus this child conversation" command driven
 * by clicking a subagent chip inside a message, and the displayed Task scope (latest vs. the
 * historical Task a chip was clicked on — see taskScope).
 *
 * VISIBILITY IS TASK-SCOPED — this deliberately diverges from the Files panel's
 * open-persists-across-sessions convention: an open panel belongs to the task it was opened
 * for. Starting a new Task (a user message) closes it by default, entering a session starts
 * closed, and it comes back only via a manual open (toolbar/chip) or the CURRENT task spawning
 * a subagent (auto-open, re-armed per task). The pure tracker below
 * (createPanelTaskScope/advancePanelTaskScope) owns those boundary decisions; the chat page
 * observes the stream and applies its actions.
 *
 * Width remains a layout preference persisted to localStorage, and the focus command uses the
 * fresh-object idiom so clicking the same chip again still re-triggers the panel's focus
 * effect.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { SheetSnap } from "../../components/ui/sheet";

export interface SubagentsPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Snap point for the mobile bottom Sheet; unused in the desktop docked state. */
  sheetSnap: SheetSnap;
  setSheetSnap: (snap: SheetSnap) => void;
  /** Clicking a subagent chip: commands the panel to select this child conversation. `origin` is the full chain ending with the child's own session id. */
  focusSubagent: (sessionId: string, origin: string[]) => void;
  /** The external focus command produced by focusSubagent; a fresh object per call (identity-compared, so re-clicking the same chip re-triggers the effect). */
  focusRequest: { sessionId: string; origin: string[] } | null;
  /**
   * Which Task's topology the panel displays. Null = the LATEST Task (the default: opening via
   * the toolbar resets to it, and so does switching Sessions). A chip click pins the graph to
   * the Task containing that chip instead — `anchorSessionId` is the clicked child's TOP-LEVEL
   * ancestor (the first origin hop; for deeper chips inside the panel the referencing main-
   * stream item belongs to that ancestor), which the view resolves to its Task slice via
   * extractTopologyForChild, so a chip on an older turn shows that turn's historical graph.
   */
  taskScope: { anchorSessionId: string } | null;
  /** Docked at >=1024px (lg); otherwise a bottom Sheet — mounted mutually exclusively. */
  isDocked: boolean;
  width: number;
  resizing: boolean;
  startResize: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** Double-clicking the drag handle: width reverts to the window-proportional default. */
  resetWidth: () => void;
  /** Ref to the docked panel's root node (drag-to-resize measures its right edge). */
  panelRef: RefObject<HTMLDivElement | null>;
}

const MIN_WIDTH = 320;
const DOCK_QUERY = "(min-width: 1024px)";
const WIDTH_STORAGE_KEY = "penguin.subagentsPanelWidth";

// ---------------------------------------------------------------------------
// Task-scoped visibility tracker (pure — unit-tested in test/panel-task-scope.test.ts)
// ---------------------------------------------------------------------------

/**
 * Mutable tracker state, held in a ref by the chat page. `taskCount` is the number of
 * Task-starting user items observed in the session's stream (taskStartCount in
 * agent-topology.ts); an increase IS the "user started a new Task" boundary.
 */
export interface PanelTaskScope {
  sessionId: string | null;
  taskCount: number;
  /** Task ordinal (the taskCount value) whose one auto-open attempt was already consumed; null = armed. */
  autoOpenedAt: number | null;
}

export function createPanelTaskScope(): PanelTaskScope {
  return { sessionId: null, taskCount: 0, autoOpenedAt: null };
}

/**
 * Advance the tracker with one observation of the current session's stream and return what the
 * panel should do — the whole task-scoped lifecycle in one place:
 *   - session switch → "close" (a session is entered closed; no inherited open state), unless
 *     its CURRENT task already has a live spawn, which wins as "autoOpen" (a mid-run entry —
 *     reload included — counts as the spawn introducing itself);
 *   - a new Task (taskCount increase) → "close" by default (an unrelated task must not inherit
 *     an open panel) and RE-ARMS the auto-open;
 *   - a live spawn in the current task → "autoOpen", at most once per task — a manual close
 *     afterwards is respected until the next boundary;
 *   - anything else (steering, compaction, more messages in the same task) → null.
 * A taskCount DECREASE is a defensive re-baseline (a resync swapped in a smaller model):
 * adopted silently — no boundary, and the auto-open attempt counts as consumed so a rebuild
 * can never surprise-reopen a panel the user closed mid-task.
 * The caller applies "autoOpen" under its own layout guards (docked, files panel closed, not
 * already open); the attempt is consumed here regardless, so a suppressed attempt never
 * retriggers within the same task.
 */
export function advancePanelTaskScope(
  state: PanelTaskScope,
  obs: { sessionId: string | null; taskCount: number; liveSpawn: boolean },
): "close" | "autoOpen" | null {
  const switched = obs.sessionId !== state.sessionId;
  const newTask = !switched && obs.taskCount > state.taskCount;
  const rebaseline = !switched && obs.taskCount < state.taskCount;
  if (switched || obs.taskCount !== state.taskCount) {
    state.sessionId = obs.sessionId;
    state.taskCount = obs.taskCount;
    // A real boundary re-arms the auto-open; the defensive re-baseline marks it consumed.
    state.autoOpenedAt = rebaseline ? obs.taskCount : null;
  }
  if (obs.liveSpawn && state.autoOpenedAt !== state.taskCount) {
    state.autoOpenedAt = state.taskCount;
    return "autoOpen";
  }
  if (switched || newTask) return "close";
  return null;
}

/** Width cap: at most half the window (keeping the chat column usable), plus a hard 720px readability ceiling. */
function maxWidthFor(windowWidth: number): number {
  return Math.max(MIN_WIDTH, Math.min(720, Math.round(windowWidth * 0.5)));
}

/** Default width ≈ 1/3 of the window, clamped within the min/max bounds (same proportion as the Files panel). */
function defaultWidthFor(windowWidth: number): number {
  return Math.min(maxWidthFor(windowWidth), Math.max(MIN_WIDTH, Math.round(windowWidth * 0.34)));
}

/** Initial width: stored preference (clamped back within the current window's bounds) over the proportional default. */
function initialWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return defaultWidthFor(window.innerWidth);
  return Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, Math.round(stored)));
}

export function useSubagentsPanel(sessionId: string | null): SubagentsPanelState {
  const [open, setOpenRaw] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");
  const [focusRequest, setFocusRequest] = useState<{
    sessionId: string;
    origin: string[];
  } | null>(null);
  const [taskScope, setTaskScope] = useState<{ anchorSessionId: string } | null>(null);

  /**
   * Opening defaults to browsing intent (Sheet at half) on the LATEST Task's graph;
   * focusSubagent's conversation intent — queued in the same batch on the chip path — then
   * promotes the snap to full and pins the scope to the chip's Task.
   */
  const setOpen = useCallback((next: boolean) => {
    if (next) {
      setSheetSnap("half");
      setTaskScope(null);
    }
    setOpenRaw(next);
  }, []);
  const [width, setWidth] = useState(initialWidth);
  /** Synchronous mirror of width, read by the mouseup persist step (sidesteps the stale closure). */
  const widthRef = useRef(width);
  const [resizing, setResizing] = useState(false);
  const [isDocked, setIsDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);
  const panelRef = useRef<HTMLDivElement>(null);

  // Switching Session resets the focus command and any pinned historical Task scope (both
  // pointed into the old session's stream — the new session opens on its latest topology).
  // The open/closed state is NOT touched here: visibility is task-scoped and owned by the
  // chat page's tracker (advancePanelTaskScope above), which closes on session entry and new
  // Tasks, and auto-opens on the current task's first live spawn.
  useEffect(() => {
    setFocusRequest(null);
    setTaskScope(null);
  }, [sessionId]);

  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDocked(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const focusSubagent = useCallback((sid: string, origin: string[]) => {
    setSheetSnap("full"); // Conversation intent: the child transcript needs the space on mobile
    // Pin the graph to this chip's Task (the top-level ancestor anchors the slice lookup) —
    // ordered after the setOpen(true) of the same click, so the pin wins the batch.
    setTaskScope({ anchorSessionId: origin[0] ?? sid });
    setFocusRequest({ sessionId: sid, origin });
  }, []);

  // Drag-to-resize: identical handling to the Files panel (see use-files-panel.ts for the rationale comments).
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      const right = rect ? rect.right : window.innerWidth;
      const next = Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, right - e.clientX));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(widthRef.current)));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  const startResize = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  const resetWidth = useCallback(() => {
    const next = defaultWidthFor(window.innerWidth);
    widthRef.current = next;
    setWidth(next);
    // Clear rather than write the default: the default keeps following the window's proportion.
    localStorage.removeItem(WIDTH_STORAGE_KEY);
  }, []);

  // When the window shrinks, clamp the panel back within the cap (shrinks only, like the Files panel).
  useEffect(() => {
    const onResize = () => {
      setWidth((w) => {
        const clamped = Math.min(w, maxWidthFor(window.innerWidth));
        if (clamped !== w) widthRef.current = clamped;
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    open,
    setOpen,
    sheetSnap,
    setSheetSnap,
    focusSubagent,
    focusRequest,
    taskScope,
    isDocked,
    width,
    resizing,
    startResize,
    resetWidth,
    panelRef,
  };
}
