/**
 * Memory panel state machine — the Memory side panel is a peer of the subagents and files
 * panels (chat-page wraps all three setOpens with the same exclusivity choreography) and
 * mirrors use-files-panel.ts: open/close, the responsive docked-vs-Sheet breakpoint, and
 * one navigation command. The command (`openMemory`) carries the Memory view's entry
 * routing (memory-nav.ts): a locate target lands on that memory's detail, null lands on
 * the list — so every entry point (toolbar toggle, card header, card row) goes through it
 * and the view never needs to guess where the user came from.
 *
 * Only the navigation command resets when sessionId changes; the open/closed state
 * persists across Sessions, matching the other two panels.
 */
import { useCallback, useEffect, useState } from "react";
import type { SheetSnap } from "../../components/ui/sheet";
import type { MemoryLocateTarget } from "../../lib/omni/memory-changes";
import { usePanelWidth } from "./use-panel-width";
import type { PanelWidthState } from "./use-panel-width";

export interface MemoryPanelState extends PanelWidthState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Snap point for the mobile bottom Sheet; unused in the desktop docked state. */
  sheetSnap: SheetSnap;
  setSheetSnap: (snap: SheetSnap) => void;
  /** Navigation command: a target lands on that memory's detail (card row), null on the list (toolbar / card header). */
  openMemory: (target: MemoryLocateTarget | null) => void;
  /** The command produced by openMemory; a new object per call so repeating the same target still re-triggers the view's routing effect (compared by identity, like the files panel's openRequest). */
  memoryRequest: { target: MemoryLocateTarget | null } | null;
  /** Docked at >=1024px (lg); otherwise falls back to the bottom Sheet — same breakpoint as the sibling panels. */
  isDocked: boolean;
}

const DOCK_QUERY = "(min-width: 1024px)";

export function useMemoryPanel(sessionId: string | null): MemoryPanelState {
  const [open, setOpenRaw] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");
  const [memoryRequest, setMemoryRequest] = useState<{
    target: MemoryLocateTarget | null;
  } | null>(null);

  /** Opening defaults to browsing intent (Sheet at half); openMemory's locate overrides to full in the same batch. */
  const setOpen = useCallback((next: boolean) => {
    if (next) setSheetSnap("half");
    setOpenRaw(next);
  }, []);
  const widthState = usePanelWidth();
  const [isDocked, setIsDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);

  // Switching Session/Agent only resets the navigation command (which pointed at the old
  // session's changes); the open/closed state deliberately survives.
  useEffect(() => {
    setMemoryRequest(null);
  }, [sessionId]);

  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDocked(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const openMemory = useCallback((target: MemoryLocateTarget | null) => {
    if (target !== null) setSheetSnap("full"); // A located diff needs the space, like file preview
    setMemoryRequest({ target });
  }, []);

  return {
    open,
    setOpen,
    sheetSnap,
    setSheetSnap,
    openMemory,
    memoryRequest,
    isDocked,
    ...widthState,
  };
}
