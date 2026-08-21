/**
 * Files panel state machine: panel open/close, the responsive breakpoint for desktop docking
 * vs. falling back to a mobile drawer, and the "locate a file in the directory tree" navigation
 * command (driven by clicking a file chip inside a message). Drag-to-resize and the width live
 * in use-panel-width.ts, shared with the Agents and Memory panels so they all open at the
 * same width.
 *
 * The panel's content is just WorkspaceBrowser's single directory-tree view — the protocol has no
 * structured file-write signal at all (file writes can happen inside the opaque exec_command shell),
 * so there's no "Agent output" list to maintain; a file clicked in a message jumps straight to
 * locating it in the tree.
 *
 * Only the navigation command resets when sessionId changes; the open/closed state persists
 * across Sessions (once opened, it stays open — a panel the user opened is part of their
 * browsing environment, and switching conversations shouldn't collapse it). Starting a NEW chat
 * is the one reset point, and it belongs to the chat page, which owns every docked panel: see
 * the draft effect in chat-page.tsx.
 */
import { useCallback, useEffect, useState } from "react";
import type { SheetSnap } from "../../components/ui/sheet";
import { usePanelWidth } from "./use-panel-width";
import type { PanelWidthState } from "./use-panel-width";

export interface FilesPanelState extends PanelWidthState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Snap point for the mobile bottom Sheet (half = browsing / full = preview); unused in the desktop docked state. */
  sheetSnap: SheetSnap;
  setSheetSnap: (snap: SheetSnap) => void;
  /** Clicking a file chip in a message: commands WorkspaceBrowser to navigate to and locate that file. */
  browsePath: (path: string) => void;
  /** The external navigation command produced by browsePath; each call creates a new object
   *  reference, ensuring that clicking the same file again still re-triggers WorkspaceBrowser's
   *  locate effect (compared by object identity, not by path value). */
  openRequest: { path: string } | null;
  /** Docked at >=1024px (lg); otherwise falls back to a Drawer overlay. Responsive, updates live
   *  as the window width changes — docked and Drawer are mounted mutually exclusively; mounting
   *  both at once would cause WorkspaceBrowser's own data requests to fire twice. */
  isDocked: boolean;
}

const DOCK_QUERY = "(min-width: 1024px)";

export function useFilesPanel(sessionId: string | null): FilesPanelState {
  const [open, setOpenRaw] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");
  const [openRequest, setOpenRequest] = useState<{ path: string } | null>(null);

  /** Opening the panel defaults to browsing intent (Sheet snaps to half); browsePath's preview
   *  intent overrides it to full within the same batch, without flickering. Closing doesn't
   *  change the snap point. In the desktop docked state, sheetSnap is unused by anything, so this has no side effect there. */
  const setOpen = useCallback((next: boolean) => {
    if (next) setSheetSnap("half");
    setOpenRaw(next);
  }, []);
  const widthState = usePanelWidth();
  const [isDocked, setIsDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);

  // Switching Session/Agent only resets the navigation command (which pointed at a file in the
  // old session); the open/closed state deliberately survives — see the header note.
  useEffect(() => {
    setOpenRequest(null);
  }, [sessionId]);

  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDocked(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const browsePath = useCallback((path: string) => {
    setSheetSnap("full"); // Preview intent: opens the mobile Sheet fully
    setOpenRequest({ path });
  }, []);

  return {
    open,
    setOpen,
    sheetSnap,
    setSheetSnap,
    browsePath,
    openRequest,
    isDocked,
    ...widthState,
  };
}
