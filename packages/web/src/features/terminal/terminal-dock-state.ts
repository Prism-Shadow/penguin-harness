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

/** Which edge of the content area the dock occupies. */
export type DockPosition = "top" | "bottom" | "left" | "right";

const POSITIONS: readonly DockPosition[] = ["top", "bottom", "left", "right"];

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

export function subscribeTerminalDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
