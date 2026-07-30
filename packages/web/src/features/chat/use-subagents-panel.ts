/**
 * Subagents panel state machine (a sibling of use-files-panel.ts, which documents the shared
 * mechanics): panel open/close, the desktop-dock vs. mobile-Sheet breakpoint, the "focus this
 * child conversation" command driven by clicking a subagent chip inside a message, and the
 * displayed Task scope (latest vs. the historical Task a chip was clicked on — see taskScope).
 * Width and drag-to-resize live in use-panel-width.ts, shared with the Files panel so the two
 * mutually exclusive panels always open at the same width.
 *
 * Visibility now follows the Files panel: an open panel survives a Session switch, and only a
 * NEW chat resets both to closed (the chat page owns that reset — it owns both panels). What
 * stays specific to this panel is the AUTO-OPEN: the current Task's first live spawn opens it
 * once, re-armed at each task boundary, so a manual close mid-task is respected. The pure
 * tracker below (createPanelTaskScope/advancePanelTaskScope) owns that decision; the chat page
 * observes the stream and applies it under its own layout guards.
 *
 * The focus command uses the fresh-object idiom so clicking the same chip again still
 * re-triggers the panel's focus effect.
 */
import { useCallback, useEffect, useState } from "react";
import type { SheetSnap } from "../../components/ui/sheet";
import { usePanelWidth } from "./use-panel-width";
import type { PanelWidthState } from "./use-panel-width";

export interface SubagentsPanelState extends PanelWidthState {
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
}

const DOCK_QUERY = "(min-width: 1024px)";

// ---------------------------------------------------------------------------
// Auto-open tracker (pure — unit-tested in test/panel-task-scope.test.ts)
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
 * Advance the tracker with one observation of the current session's stream and return whether
 * the panel should auto-open:
 *   - a live spawn in the current task → "autoOpen", at most once per task, so a manual close
 *     afterwards is respected until the next boundary;
 *   - a boundary (a Session switch, or a new Task within the session) RE-ARMS that one attempt
 *     but is never itself an action — an open panel is not closed here any more. Entering a
 *     session mid-run therefore auto-opens on the spawn that is already live, which reads as
 *     that spawn introducing itself;
 *   - anything else (steering, compaction, more messages in the same task) → null.
 * A taskCount DECREASE is a defensive re-baseline (a resync swapped in a smaller model):
 * adopted silently, with the auto-open attempt marked consumed so a rebuild can never
 * surprise-open a panel the user closed mid-task.
 * The caller applies "autoOpen" under its own layout guards (docked, Files panel closed, not
 * already open); the attempt is consumed here regardless, so a suppressed attempt never
 * retriggers within the same task.
 */
export function advancePanelTaskScope(
  state: PanelTaskScope,
  obs: { sessionId: string | null; taskCount: number; liveSpawn: boolean },
): "autoOpen" | null {
  const switched = obs.sessionId !== state.sessionId;
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
  return null;
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
  const widthState = usePanelWidth();
  const [isDocked, setIsDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);

  // Switching Session resets the focus command and any pinned historical Task scope (both
  // pointed into the old session's stream — the new session opens on its latest topology).
  // The open/closed state is NOT touched: like the Files panel, an open panel survives the
  // switch, and only a new chat closes it (chat-page.tsx).
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

  return {
    open,
    setOpen,
    sheetSnap,
    setSheetSnap,
    focusSubagent,
    focusRequest,
    taskScope,
    isDocked,
    ...widthState,
  };
}
