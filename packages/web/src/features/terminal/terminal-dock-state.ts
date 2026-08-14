/**
 * Open/closed state and screen position of the in-app terminal dock, as a tiny
 * module-level store.
 *
 * A store (rather than component state) because the consumers live far apart: the chat
 * toolbar and the global Ctrl+` handler flip `open`, AppLayout reads `position` to decide
 * which side of the content area the dock occupies, and the dock's drag-to-dock overlay
 * writes it. Both persist so the dock survives a reload the same way the shell behind it
 * does.
 */

const STORAGE_KEY = "penguin.terminal.dockOpen";
const POSITION_KEY = "penguin.terminal.dockPosition";
const HEIGHT_RATIO_KEY = "penguin.terminal.dockHeightRatio";
const WIDTH_RATIO_KEY = "penguin.terminal.dockWidthRatio";

/** Which edge of the content area the dock occupies. */
export type DockPosition = "top" | "bottom" | "left" | "right";

const POSITIONS: readonly DockPosition[] = ["top", "bottom", "left", "right"];

/**
 * Dock sizes are RATIOS of the layout row, not pixels: top/bottom share one height ratio,
 * left/right share one width ratio. That is what makes a resize survive repositioning and
 * window resizes proportionally. The px minimums (and the ratio ceiling, which also leaves
 * the main content room) are enforced both by the dock's CSS and by the drag preview.
 */
export const DEFAULT_DOCK_HEIGHT_RATIO = 0.4;
export const DEFAULT_DOCK_WIDTH_RATIO = 0.33;
export const DOCK_RATIO_MIN = 0.15;
export const DOCK_RATIO_MAX = 0.85;
export const DOCK_MIN_HEIGHT_PX = 140;
export const DOCK_MIN_WIDTH_PX = 320;

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DOCK_RATIO_MIN;
  return Math.min(DOCK_RATIO_MAX, Math.max(DOCK_RATIO_MIN, value));
}

function loadRatio(key: string, fallback: number): number {
  try {
    const stored = Number.parseFloat(localStorage.getItem(key) ?? "");
    return Number.isFinite(stored) ? clampRatio(stored) : fallback;
  } catch {
    return fallback;
  }
}

let open = ((): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();

let position: DockPosition = ((): DockPosition => {
  try {
    const stored = localStorage.getItem(POSITION_KEY);
    return POSITIONS.includes(stored as DockPosition) ? (stored as DockPosition) : "bottom";
  } catch {
    return "bottom";
  }
})();

let heightRatio = loadRatio(HEIGHT_RATIO_KEY, DEFAULT_DOCK_HEIGHT_RATIO);
let widthRatio = loadRatio(WIDTH_RATIO_KEY, DEFAULT_DOCK_WIDTH_RATIO);

const listeners = new Set<() => void>();

export function isTerminalDockOpen(): boolean {
  return open;
}

export function setTerminalDockOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Private-mode storage failures only cost persistence.
  }
  for (const listener of [...listeners]) listener();
}

export function toggleTerminalDock(): void {
  setTerminalDockOpen(!open);
}

export function terminalDockPosition(): DockPosition {
  return position;
}

export function setTerminalDockPosition(next: DockPosition): void {
  if (next === position) return;
  position = next;
  try {
    localStorage.setItem(POSITION_KEY, next);
  } catch {
    // Private-mode storage failures only cost persistence.
  }
  for (const listener of [...listeners]) listener();
}

export function terminalDockHeightRatio(): number {
  return heightRatio;
}

export function terminalDockWidthRatio(): number {
  return widthRatio;
}

export function setTerminalDockHeightRatio(next: number): void {
  const clamped = clampRatio(next);
  if (clamped === heightRatio) return;
  heightRatio = clamped;
  try {
    localStorage.setItem(HEIGHT_RATIO_KEY, String(clamped));
  } catch {
    // Private-mode storage failures only cost persistence.
  }
  for (const listener of [...listeners]) listener();
}

export function setTerminalDockWidthRatio(next: number): void {
  const clamped = clampRatio(next);
  if (clamped === widthRatio) return;
  widthRatio = clamped;
  try {
    localStorage.setItem(WIDTH_RATIO_KEY, String(clamped));
  } catch {
    // Private-mode storage failures only cost persistence.
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeTerminalDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
