/**
 * Files panel state machine: panel open/close, drag-to-resize, the responsive breakpoint for
 * desktop docking vs. falling back to a mobile drawer, and the "locate a file in the directory
 * tree" navigation command (driven by clicking a file chip inside a message).
 *
 * The panel's content is just WorkspaceBrowser's single directory-tree view — the protocol has no
 * structured file-write signal at all (the only built-in tool is the opaque exec_command shell),
 * so there's no "Agent output" list to maintain; a file clicked in a message jumps straight to
 * locating it in the tree.
 *
 * Only the navigation command resets when sessionId changes; the open/closed state persists
 * across sessions (once opened, it stays open); width is a layout preference, not session data,
 * so it isn't reset, and it's persisted to localStorage (same as app-layout.tsx's
 * sidebarCollapsed). Both the default width and the cap scale proportionally with the window
 * width (matching the ~1/3-of-window feel of Codex's Review panel); a dragged preference takes
 * priority over the proportional default; double-clicking the handle clears the preference and
 * reverts to the proportional default.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { SheetSnap } from "../../components/ui/sheet";

export interface FilesPanelState {
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
  width: number;
  resizing: boolean;
  startResize: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** Double-clicking the drag handle: width reverts to the window-proportional default, and the stored preference is cleared. */
  resetWidth: () => void;
  /** Ref to the docked panel's root node: drag-to-resize uses its right edge to compute the target width. */
  panelRef: RefObject<HTMLDivElement | null>;
}

const MIN_WIDTH = 320;
const DOCK_QUERY = "(min-width: 1024px)";
const WIDTH_STORAGE_KEY = "penguin.filesPanelWidth";

/** Width cap: at most half the window (keeping the chat column usable), plus a hard 720px readability ceiling. */
function maxWidthFor(windowWidth: number): number {
  return Math.max(MIN_WIDTH, Math.min(720, Math.round(windowWidth * 0.5)));
}

/** Default width ≈ 1/3 of the window (matching Codex's Review panel proportion), clamped within the min/max bounds. */
function defaultWidthFor(windowWidth: number): number {
  return Math.min(maxWidthFor(windowWidth), Math.max(MIN_WIDTH, Math.round(windowWidth * 0.34)));
}

/** Initial width: stored preference (clamped back within the current window's bounds, to prevent an oversized value carried over from another device) takes priority over the proportional default. */
function initialWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return defaultWidthFor(window.innerWidth);
  return Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, Math.round(stored)));
}

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
  const [width, setWidth] = useState(initialWidth);
  /** A synchronous mirror of width: read by the mouseup persist step, sidestepping the stale state captured in the event closure. */
  const widthRef = useRef(width);
  const [resizing, setResizing] = useState(false);
  const [isDocked, setIsDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);
  const panelRef = useRef<HTMLDivElement>(null);

  // Switching Session/Agent only resets the navigation command (which pointed at a file in the
  // old session); the open/closed state persists across sessions — a workspace panel the user
  // opened is part of their browsing environment, and switching sessions shouldn't collapse it.
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

  // Drag-to-resize: during mousemove, computes the width from the panel's right edge and clamps
  // it within the min/max bounds; locks the cursor/selection during the drag to avoid
  // accidentally selecting page text on a fast drag (standard, necessary handling for
  // drag-to-resize, not something to skip just because there's no prior precedent here).
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      const right = rect ? rect.right : window.innerWidth;
      const next = Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, right - e.clientX));
      widthRef.current = next;
      setWidth(next);
    };
    // Only persist the preference once the drag ends: mousemove fires every frame, and it's not worth writing to localStorage on every frame.
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
    // Clears rather than writing the default value: this way the default keeps following the window's proportion going forward, instead of being frozen at the current pixel value.
    localStorage.removeItem(WIDTH_STORAGE_KEY);
  }, []);

  // When the window shrinks, clamp the panel back within the cap to prevent the docked panel
  // from crowding out the chat column. Only shrinks, never grows back: this doesn't overwrite
  // the stored preference; enlarging the window again relies on a refresh or double-clicking the handle to restore it.
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
    browsePath,
    openRequest,
    isDocked,
    width,
    resizing,
    startResize,
    resetWidth,
    panelRef,
  };
}
