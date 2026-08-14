/**
 * State of the in-app terminal dock system, as a tiny module-level store.
 *
 * The dock is a set of PANES, at most one per edge of the content area. Terminals are
 * assigned to a pane (dragging a tab onto an edge moves it, creating the pane on demand);
 * each pane remembers which of its terminals it is showing. One `visible` flag hides and
 * restores the whole arrangement (Ctrl+`), so a toggle never loses the layout.
 *
 * A store (rather than component state) because the consumers live far apart: the chat
 * toolbar and the global hotkey flip visibility, AppLayout renders a pane per open edge,
 * and the drag/drop interactions inside any pane reshape the arrangement. Everything
 * persists so a reload restores panes, sizes and assignments the same way the shells
 * behind them survive server-side.
 */

const VISIBLE_KEY = "penguin.terminal.dockOpen";
const PANES_KEY = "penguin.terminal.dockPanes";
const RATIOS_KEY = "penguin.terminal.dockRatios";
const ASSIGN_KEY = "penguin.terminal.paneAssignments";
const CURRENTS_KEY = "penguin.terminal.paneCurrents";

/** Which edge of the content area a pane occupies. */
export type DockPosition = "top" | "bottom" | "left" | "right";

const POSITIONS: readonly DockPosition[] = ["top", "bottom", "left", "right"];

/**
 * Pane sizes are RATIOS of the layout row, per position. The px minimums (and the ratio
 * ceiling, which also leaves the main content room) are enforced both by the pane's CSS
 * and by the drag preview.
 */
export const DEFAULT_DOCK_HEIGHT_RATIO = 0.4;
export const DEFAULT_DOCK_WIDTH_RATIO = 0.33;
export const DOCK_RATIO_MIN = 0.15;
export const DOCK_RATIO_MAX = 0.85;
export const DOCK_MIN_HEIGHT_PX = 140;
export const DOCK_MIN_WIDTH_PX = 320;

export function isHorizontal(position: DockPosition): boolean {
  return position === "top" || position === "bottom";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DOCK_RATIO_MIN;
  return Math.min(DOCK_RATIO_MAX, Math.max(DOCK_RATIO_MIN, value));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode storage failures only cost persistence.
  }
}

let visible = ((): boolean => {
  try {
    return localStorage.getItem(VISIBLE_KEY) === "1";
  } catch {
    return false;
  }
})();

let panes: DockPosition[] = readJson<DockPosition[]>(PANES_KEY, []).filter((p): p is DockPosition =>
  POSITIONS.includes(p),
);

let ratios: Partial<Record<DockPosition, number>> = readJson(RATIOS_KEY, {});

/** terminalId -> pane. Unassigned terminals belong to the primary (first open) pane. */
let assignments: Record<string, DockPosition> = readJson(ASSIGN_KEY, {});

/** Which terminal each pane is showing. */
let currents: Partial<Record<DockPosition, string>> = readJson(CURRENTS_KEY, {});

const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Monotonic change counter — subscribe with this snapshot to re-render on ANY change. */
export function dockStateVersion(): number {
  return version;
}

export function subscribeTerminalDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------- visibility

export function isTerminalDockOpen(): boolean {
  return visible && panes.length > 0;
}

function persistVisible(next: boolean): void {
  visible = next;
  try {
    localStorage.setItem(VISIBLE_KEY, next ? "1" : "0");
  } catch {
    // Private-mode storage failures only cost persistence.
  }
}

export function setTerminalDockOpen(next: boolean): void {
  persistVisible(next);
  if (next && panes.length === 0) panes = ["bottom"];
  writeJson(PANES_KEY, panes);
  notify();
}

export function toggleTerminalDock(): void {
  setTerminalDockOpen(!isTerminalDockOpen());
}

// Ctrl+` (the Codex/VS Code binding), registered at module scope: a React-effect listener
// leaves a window after first paint where the shortcut is silently dead — an effect runs
// after paint, and a keypress can land in between. The store is page-global anyway; on
// routes without the dock (login, /terminal) the toggle just flips hidden state.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key !== "`" && event.code !== "Backquote") return;
    event.preventDefault();
    toggleTerminalDock();
  });
}

// --------------------------------------------------------------------------------- panes

/** Open panes; stable snapshot (same reference until contents change). */
export function openPanes(): DockPosition[] {
  return panes;
}

/** The pane unassigned terminals belong to. */
export function primaryPane(): DockPosition {
  return panes[0] ?? "bottom";
}

export function ensurePaneOpen(position: DockPosition): void {
  persistVisible(true);
  if (!panes.includes(position)) {
    panes = [...panes, position];
    writeJson(PANES_KEY, panes);
  }
  notify();
}

/**
 * Closes one pane. Its terminals fold back into the primary remaining pane (the shells
 * keep running server-side either way); closing the last pane hides the dock.
 */
export function closePane(position: DockPosition): void {
  if (!panes.includes(position)) return;
  panes = panes.filter((p) => p !== position);
  writeJson(PANES_KEY, panes);
  delete currents[position];
  writeJson(CURRENTS_KEY, currents);
  const fallback = panes[0];
  assignments = Object.fromEntries(
    Object.entries(assignments).flatMap(([id, pane]) => {
      if (pane !== position) return [[id, pane]];
      return fallback ? [[id, fallback]] : [];
    }),
  );
  writeJson(ASSIGN_KEY, assignments);
  if (panes.length === 0) persistVisible(false);
  notify();
}

// -------------------------------------------------------------------------------- ratios

export function paneRatio(position: DockPosition): number {
  const fallback = isHorizontal(position) ? DEFAULT_DOCK_HEIGHT_RATIO : DEFAULT_DOCK_WIDTH_RATIO;
  const stored = ratios[position];
  return typeof stored === "number" ? clampRatio(stored) : fallback;
}

export function setPaneRatio(position: DockPosition, next: number): void {
  const clamped = clampRatio(next);
  if (clamped === ratios[position]) return;
  ratios = { ...ratios, [position]: clamped };
  writeJson(RATIOS_KEY, ratios);
  notify();
}

export function resetPaneRatio(position: DockPosition): void {
  const { [position]: _dropped, ...rest } = ratios;
  ratios = rest;
  writeJson(RATIOS_KEY, ratios);
  notify();
}

// --------------------------------------------------------------------- pane assignments

/** The pane a terminal belongs to (its assigned pane while open, else the primary one). */
export function paneOfTerminal(id: string): DockPosition {
  const assigned = assignments[id];
  return assigned !== undefined && panes.includes(assigned) ? assigned : primaryPane();
}

/** Moves a terminal to a pane (opening it if needed) and shows it there. */
export function assignTerminalToPane(id: string, position: DockPosition): void {
  ensurePaneOpen(position);
  assignments = { ...assignments, [id]: position };
  writeJson(ASSIGN_KEY, assignments);
  setPaneCurrent(position, id);
}

/** Brings a terminal on screen: its pane opens (dock and all) showing it. */
export function showTerminal(id: string): void {
  const position = paneOfTerminal(id);
  ensurePaneOpen(position);
  setPaneCurrent(position, id);
}

/** Drops assignment entries for terminals that no longer exist. */
export function pruneAssignments(liveIds: ReadonlySet<string>): void {
  const next = Object.fromEntries(Object.entries(assignments).filter(([id]) => liveIds.has(id)));
  if (Object.keys(next).length === Object.keys(assignments).length) return;
  assignments = next;
  writeJson(ASSIGN_KEY, assignments);
  notify();
}

// ------------------------------------------------------------------------ pane currents

export function paneCurrent(position: DockPosition): string | null {
  return currents[position] ?? null;
}

export function setPaneCurrent(position: DockPosition, id: string | null): void {
  if ((currents[position] ?? null) === id) {
    notify(); // assignment may still have changed alongside
    return;
  }
  if (id === null) delete currents[position];
  else currents = { ...currents, [position]: id };
  writeJson(CURRENTS_KEY, currents);
  notify();
}

/**
 * Moves a whole pane to another edge: every terminal of the source pane (and its shown
 * terminal) lands on the target, merging with anything already there; the source closes.
 *
 * `memberIds` is the caller's live tab list for the source pane. It matters because
 * membership can be IMPLICIT — an unassigned terminal belongs to the primary pane without
 * an `assignments` entry — and this store does not know the live terminal list. Without
 * it, moving the primary pane would leave its unassigned tabs behind (they would silently
 * re-home to whichever pane becomes primary next).
 */
export function movePane(from: DockPosition, to: DockPosition, memberIds: string[] = []): void {
  if (from === to) return;
  const shown = currents[from] ?? null;
  const movedIds = [
    ...new Set([
      ...memberIds.filter((id) => paneOfTerminal(id) === from),
      ...Object.entries(assignments)
        .filter(([, pane]) => pane === from)
        .map(([id]) => id),
    ]),
  ];
  // A same-orientation move carries the pane's size along ("keep the ratio"): the user
  // sized THIS pane, and it is the same pane on the other edge. Cross-orientation moves
  // and merges into an existing pane keep the target's own size.
  if (
    !panes.includes(to) &&
    isHorizontal(from) === isHorizontal(to) &&
    ratios[from] !== undefined
  ) {
    ratios = { ...ratios, [to]: ratios[from] };
    writeJson(RATIOS_KEY, ratios);
  }
  ensurePaneOpen(to);
  assignments = {
    ...assignments,
    ...Object.fromEntries(movedIds.map((id) => [id, to])),
  };
  writeJson(ASSIGN_KEY, assignments);
  panes = panes.filter((p) => p !== from);
  writeJson(PANES_KEY, panes);
  delete currents[from];
  if (shown) currents = { ...currents, [to]: shown };
  writeJson(CURRENTS_KEY, currents);
  notify();
}
