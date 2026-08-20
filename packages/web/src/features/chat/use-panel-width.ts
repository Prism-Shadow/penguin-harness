/**
 * Width shared by everything that docks beside the chat: the Workspace files panel, the
 * Agents panel, and a left or right terminal pane — plus the drag-to-resize machinery the
 * two panels mount.
 *
 * All three are MUTUALLY EXCLUSIVE — opening one displaces the others — so to the user they
 * read as a single side panel that swaps its content. Independent widths made that swap
 * jump, which is why the width is one value here rather than a per-surface preference: a
 * width dragged on any of them is the width the next one opens at, immediately and after a
 * reload. The terminal pane brings its own resize gesture (it can dock on either side) and
 * writes through setPanelWidth.
 *
 * "Immediately" is what rules out two `useState`s over one storage key: only the panel that was
 * mounted and dragged would update, and the other would keep a stale copy until its next
 * remount. So the value lives in a module-level store both hooks subscribe to, and the
 * persisted preference is written once per drag (mouseup), not per frame.
 *
 * Width is a layout preference, not session data: it is never reset on a Session switch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";

const MIN_WIDTH = 320;
const WIDTH_STORAGE_KEY = "penguin.panelWidth";
/**
 * Pre-unification per-panel keys, adopted once on first load so a dragged width survives the
 * merge instead of silently snapping back to the default. The WIDER of the two wins: the two
 * panels were sized independently, so picking either one arbitrarily could hand the merged
 * panel the narrower of the user's two choices — visibly a regression on the panel that used
 * to be wide. The migration deletes the keys as it reads, so it is already dead code for anyone
 * who has opened the app once since this shipped.
 *
 * REMOVAL: delete this constant and storedWidth()'s legacy branch while preparing the release
 * AFTER 0.2.0 — the 0.1.5 backward-compatibility entry schedules it for the second release
 * after the one shipping this change (0.2.0 was the first and deliberately kept it). Nothing
 * else in the repo reads these keys, so it is a pure deletion.
 * See changelog/0.1.5/2026-07-30-backward-compatibility.md.
 */
const LEGACY_WIDTH_KEYS = ["penguin.filesPanelWidth", "penguin.subagentsPanelWidth"] as const;

/** Width cap: at most half the window (keeping the chat column usable), plus a hard 720px readability ceiling. */
export function maxWidthFor(windowWidth: number): number {
  return Math.max(MIN_WIDTH, Math.min(720, Math.round(windowWidth * 0.5)));
}

/**
 * Default width ≈ 40% of the window, clamped within the min/max bounds. Deliberately wider than
 * the old ~1/3: one panel now serves both the file tree and the subagent transcript, and the
 * transcript is the demanding tenant — a third of the window renders it as a narrow column of
 * wrapped tool output.
 */
export function defaultWidthFor(windowWidth: number): number {
  return Math.min(maxWidthFor(windowWidth), Math.max(MIN_WIDTH, Math.round(windowWidth * 0.4)));
}

/** Reads the stored preference, migrating a legacy per-panel key the first time. Returns null when nothing is stored. */
function storedWidth(): number | null {
  try {
    const own = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(own) && own > 0) return own;
    let adopted: number | null = null;
    for (const key of LEGACY_WIDTH_KEYS) {
      const legacy = Number(localStorage.getItem(key));
      // Widest wins — see LEGACY_WIDTH_KEYS: the merged panel must not come out narrower than
      // either panel the user had sized.
      if (Number.isFinite(legacy) && legacy > 0) adopted = Math.max(adopted ?? 0, legacy);
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

// null = not initialized yet: the width stays lazy (computed on the first read, i.e. the
// first mounted panel's render), exactly like the pre-zustand module variable — an eager
// initialWidth() at module load would run the legacy-key migration on every page load.
const widthStore = createStore<{ width: number | null }>(() => ({ width: null }));

function readWidth(): number {
  const { width } = widthStore.getState();
  if (width !== null) return width;
  // First read happens during the first subscriber's render, before anything subscribed:
  // seeding via setState here notifies nobody, so it is safe inside a render.
  const initial = initialWidth();
  widthStore.setState({ width: initial });
  return initial;
}

function writeWidth(next: number): void {
  if (next === widthStore.getState().width) return;
  widthStore.setState({ width: next });
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

/** The current shared width, read outside React (measuring a drop region mid-drag). */
export function panelWidth(): number {
  return readWidth();
}

/** Subscribes to the shared width alone — for a consumer with its own resize gesture. */
export function usePanelWidthValue(): number {
  return useStore(widthStore, () => readWidth());
}

/** Sets the shared width from another surface's drag, clamped to the same bounds. */
export function setPanelWidth(px: number): void {
  writeWidth(Math.min(maxWidthFor(window.innerWidth), Math.max(MIN_WIDTH, Math.round(px))));
}

/** Persists the current width; call once at the end of a drag, not per frame. */
export function persistPanelWidth(): void {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(readWidth())));
  } catch {
    /* best-effort persistence (quota / private mode) */
  }
}

/** Back to the window-proportional default, clearing the stored preference. */
export function resetPanelWidth(): void {
  writeWidth(defaultWidthFor(window.innerWidth));
  try {
    localStorage.removeItem(WIDTH_STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * The shared width plus this panel's own drag state. `resizing` and `panelRef` stay per-panel
 * (each panel has its own DOM node and its own handle); only the width crosses between them.
 */
export function usePanelWidth(): PanelWidthState {
  const width = useStore(widthStore, () => readWidth());
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
      persistPanelWidth();
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

  // Clears rather than writing the default value: this way the default keeps following the
  // window's proportion going forward, instead of being frozen at the current pixel value.
  const resetWidth = useCallback(resetPanelWidth, []);

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
