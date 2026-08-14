/**
 * Open/closed state of the in-app terminal dock, as a tiny module-level store.
 *
 * A store (rather than component state) because the toggle lives far from the dock: the
 * sidebar nav entry, the collapsed rail and the global Ctrl+` handler all flip it, while
 * the dock itself renders in AppLayout. Persisted so the dock survives a reload the same
 * way the shell behind it does.
 */

const STORAGE_KEY = "penguin.terminal.dockOpen";

let open = ((): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
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

export function subscribeTerminalDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
