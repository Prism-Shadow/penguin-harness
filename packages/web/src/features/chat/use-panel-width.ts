/**
 * Width shared by the chat page's two docked panels (Workspace files and Agents), plus the
 * drag-to-resize machinery both of them mount.
 *
 * The panels are MUTUALLY EXCLUSIVE — opening one closes the other — so to the user they read
 * as a single right-hand panel that swaps its content. Two independent widths made that swap
 * jump, which is why the width is one value here rather than a per-panel preference: a width
 * dragged on either panel is the width the other one opens at, immediately and after a reload.
 *
 * "Immediately" is what rules out two `useState`s over one storage key: only the panel that was
 * mounted and dragged would update, and the other would keep a stale copy until its next
 * remount. So the value lives in a module-level store both hooks subscribe to via
 * useSyncExternalStore, and the persisted preference is written once per drag (mouseup), not
 * per frame.
 *
 * Width is a layout preference, not session data: it is never reset on a Session switch.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

const MIN_WIDTH = 320;
const WIDTH_STORAGE_KEY = "penguin.panelWidth";
/**
 * Pre-unification per-panel keys, adopted once on first load so a dragged width survives the
 * merge instead of silently snapping back to the default. The migration deletes them as it
 * reads, so this block can be dropped in a later release with no visible effect for anyone who
 * has opened the app since — nothing else reads these keys.
 */
const LEGACY_WIDTH_KEYS = ["penguin.filesPanelWidth", "penguin.subagentsPanelWidth"] as const;

/** Width cap: at most half the window (keeping the chat column usable), plus a hard 720px readability ceiling. */
export function maxWidthFor(windowWidth: number): number {
  return Math.max(MIN_WIDTH, Math.min(720, Math.round(windowWidth * 0.5)));
}

/** Default width ≈ 1/3 of the window (matching Codex's Review panel proportion), clamped within the min/max bounds. */
export function defaultWidthFor(windowWidth: number): number {
  return Math.min(maxWidthFor(windowWidth), Math.max(MIN_WIDTH, Math.round(windowWidth * 0.34)));
}

/** Reads the stored preference, migrating a legacy per-panel key the first time. Returns null when nothing is stored. */
function storedWidth(): number | null {
  try {
    const own = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(own) && own > 0) return own;
    let adopted: number | null = null;
    for (const key of LEGACY_WIDTH_KEYS) {
      const legacy = Number(localStorage.getItem(key));
      // The Workspace panel's key is listed first and wins: it is the more used of the two.
      if (adopted === null && Number.isFinite(legacy) && legacy > 0) adopted = legacy;
      localStorage.removeItem(key);
    }
    if (adopted !== null) localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(adopted)));
    return adopted;
  } catch {
    return null; // quota / private mode: fall back to the proportional default
  }
}

/** Initial width: the stored preference (clamped back within this window's bounds, so an oversized value carried over from another device can't crowd out the chat column) over the proportional default. */
function initialWidth(): number {
  const stored = storedWidth();
  if (stored === null) return defaultWidthFor(window.innerWidth);
  return Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, Math.round(stored)));
}

// —— Module-level store: one width, every subscriber re-renders on change ——

let sharedWidth: number | null = null;
const listeners = new Set<() => void>();

function readWidth(): number {
  sharedWidth ??= initialWidth();
  return sharedWidth;
}

function writeWidth(next: number): void {
  if (next === sharedWidth) return;
  sharedWidth = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface PanelWidthState {
  width: number;
  resizing: boolean;
  startResize: (e: ReactMouseEvent<HTMLDivElement>) => void;
  /** Double-clicking the drag handle: width reverts to the window-proportional default, and the stored preference is cleared. */
  resetWidth: () => void;
  /** Ref to the docked panel's root node: drag-to-resize uses its right edge to compute the target width. */
  panelRef: RefObject<HTMLDivElement | null>;
}

/**
 * The shared width plus this panel's own drag state. `resizing` and `panelRef` stay per-panel
 * (each panel has its own DOM node and its own handle); only the width crosses between them.
 */
export function usePanelWidth(): PanelWidthState {
  const width = useSyncExternalStore(subscribe, readWidth, readWidth);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Drag-to-resize: during mousemove, computes the width from the panel's right edge and clamps
  // it within the min/max bounds; locks the cursor/selection during the drag to avoid
  // accidentally selecting page text on a fast drag.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      const right = rect ? rect.right : window.innerWidth;
      writeWidth(Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, right - e.clientX)));
    };
    // Only persist once the drag ends: mousemove fires every frame, and it's not worth writing to localStorage on every frame.
    const onUp = () => {
      setResizing(false);
      try {
        localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(readWidth())));
      } catch {
        /* best-effort persistence (quota / private mode) */
      }
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
    writeWidth(defaultWidthFor(window.innerWidth));
    // Clears rather than writing the default value: this way the default keeps following the
    // window's proportion going forward, instead of being frozen at the current pixel value.
    try {
      localStorage.removeItem(WIDTH_STORAGE_KEY);
    } catch {
      /* best-effort */
    }
  }, []);

  // When the window shrinks, clamp the width back within the cap so the docked panel can't
  // crowd out the chat column. Shrinks only, never grows back, and never overwrites the stored
  // preference: enlarging the window again relies on a refresh or a double-click on the handle.
  // Both panels register this; the clamp is idempotent, so the duplicate is harmless.
  useEffect(() => {
    const onResize = () => writeWidth(Math.min(readWidth(), maxWidthFor(window.innerWidth)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { width, resizing, startResize, resetWidth, panelRef };
}
