/**
 * State of the in-app terminal dock system, as a tiny module-level store.
 *
 * The dock is a set of PANES, at most one per edge of the content area. Terminals are
 * assigned to a pane (dragging a tab onto an edge moves it, creating the pane on demand);
 * each pane remembers which of its terminals it is showing. One `visible` flag hides and
 * restores the whole arrangement (Ctrl+`), so a toggle never loses the layout.
 *
 * The arrangement is SCOPED to the conversation it was opened in. Switching Sessions
 * switches the whole dock with it — a Session that never opened a terminal shows none, and
 * coming back restores the panes and tabs that were there. The shells themselves are
 * per-user and keep running regardless; a scope only decides which of them are on screen
 * here. Pages with no Session of their own (settings, Agents, …) keep the last one's dock
 * rather than blanking it, since navigating to a settings page is not leaving the
 * conversation.
 *
 * A store (rather than component state) because the consumers live far apart: the chat
 * toolbar and the global hotkey flip visibility, AppLayout renders a pane per open edge,
 * and the drag/drop interactions inside any pane reshape the arrangement. Everything
 * persists so a reload restores panes, sizes and assignments the same way the shells
 * behind them survive server-side.
 */

/** Every scope's arrangement, in one entry: `Record<scope, DockScopeState>`. */
const DOCK_KEY = "penguin.terminal.dock";
/** How wide/tall the user likes a pane is one preference, not one per conversation. */
const RATIOS_KEY = "penguin.terminal.dockRatios";
/** Scopes kept in storage; past that, the least recently touched conversations age out. */
const MAX_SCOPES = 40;

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
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    // `null` parses fine and then blows up on the first property read.
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : fallback;
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

/**
 * Last failure while resolving/creating a pane's shell (not persisted). Shown in the pane
 * body: a blank panel with the cause swallowed is indistinguishable from "working" — the
 * exact bug reported on macOS, where terminal creation failed server-side and nothing
 * anywhere said so.
 */
let paneErrors: Partial<Record<DockPosition, string>> = {};

/** One conversation's arrangement — everything `setDockScope` swaps. */
interface DockScopeState {
  visible: boolean;
  panes: DockPosition[];
  /** terminalId -> pane. This is also the MEMBERSHIP list: an id absent here is not shown. */
  assignments: Record<string, DockPosition>;
  /** Which terminal each pane is showing. */
  currents: Partial<Record<DockPosition, string>>;
}

function emptyScope(): DockScopeState {
  return { visible: false, panes: [], assignments: {}, currents: {} };
}

/**
 * The scope the dock belongs to before any conversation is open — the login screen, a
 * settings page reached directly by URL. A real Session id never collides with it.
 */
const NO_SESSION_SCOPE = "~none";

/**
 * One stored scope, made safe to use. Storage is user-writable and survives across
 * versions, so a malformed entry has to degrade to an empty dock — this runs at module
 * load, where a throw would take the whole app down with it.
 */
function sanitizeScope(raw: unknown): DockScopeState {
  const state = (raw ?? {}) as Partial<DockScopeState>;
  const panes = Array.isArray(state.panes)
    ? state.panes.filter((p): p is DockPosition => POSITIONS.includes(p))
    : [];
  const entries = (value: unknown): Array<[string, unknown]> =>
    typeof value === "object" && value !== null ? Object.entries(value) : [];
  return {
    visible: state.visible === true,
    panes,
    assignments: Object.fromEntries(
      entries(state.assignments).filter((entry): entry is [string, DockPosition] =>
        POSITIONS.includes(entry[1] as DockPosition),
      ),
    ),
    currents: Object.fromEntries(
      entries(state.currents).filter(
        (entry): entry is [DockPosition, string] =>
          POSITIONS.includes(entry[0] as DockPosition) && typeof entry[1] === "string",
      ),
    ),
  };
}

let scopes: Record<string, DockScopeState> = Object.fromEntries(
  Object.entries(readJson<Record<string, unknown>>(DOCK_KEY, {})).map(([key, value]) => [
    key,
    sanitizeScope(value),
  ]),
);
let scope = NO_SESSION_SCOPE;

let ratios: Partial<Record<DockPosition, number>> = readJson(RATIOS_KEY, {});

// Unpacked into locals rather than read through `scopes[scope]` everywhere: the reads are
// on every render path, and the stable references are what let `openPanes()` be a valid
// useSyncExternalStore snapshot.
let { visible, panes, assignments, currents } = scopes[scope] ?? emptyScope();

/** Writes the live locals back into the scope map and persists it. */
function persist(): void {
  const state: DockScopeState = { visible, panes, assignments, currents };
  // An untouched scope is not worth a storage entry: visiting a conversation without ever
  // opening a terminal would otherwise leave one behind for every conversation visited.
  if (panes.length === 0 && Object.keys(assignments).length === 0) {
    const { [scope]: _dropped, ...rest } = scopes;
    scopes = rest;
  } else {
    // Re-inserted last so key order is least-recently-touched first, which is what the cap
    // below evicts by.
    const { [scope]: _previous, ...rest } = scopes;
    scopes = { ...rest, [scope]: state };
  }
  const keys = Object.keys(scopes);
  if (keys.length > MAX_SCOPES) {
    scopes = Object.fromEntries(keys.slice(keys.length - MAX_SCOPES).map((k) => [k, scopes[k]!]));
  }
  writeJson(DOCK_KEY, scopes);
}

/**
 * Points the dock at a conversation. Everything on screen changes with it; the shells
 * behind the tabs are untouched, so switching away and back costs nothing.
 */
export function setDockScope(next: string | null): void {
  const target = next ?? NO_SESSION_SCOPE;
  if (target === scope) return;
  persist();
  scope = target;
  ({ visible, panes, assignments, currents } = scopes[scope] ?? emptyScope());
  // Transient and about a pane that is no longer on screen.
  paneErrors = {};
  notify();
}

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

export function setTerminalDockOpen(next: boolean): void {
  visible = next;
  if (next && panes.length === 0) panes = ["bottom"];
  persist();
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
  visible = true;
  if (!panes.includes(position)) panes = [...panes, position];
  persist();
  notify();
}

/**
 * Closes one pane. Its terminals fold back into the primary remaining pane (the shells
 * keep running server-side either way); closing the last pane hides the dock.
 */
export function closePane(position: DockPosition): void {
  if (!panes.includes(position)) return;
  panes = panes.filter((p) => p !== position);
  delete currents[position];
  const fallback = panes[0];
  assignments = Object.fromEntries(
    Object.entries(assignments).flatMap(([id, pane]) => {
      if (pane !== position) return [[id, pane]];
      return fallback ? [[id, fallback]] : [];
    }),
  );
  if (panes.length === 0) visible = false;
  persist();
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

/**
 * The pane a terminal is shown in, or null when this scope does not hold it at all.
 *
 * Membership is explicit — a terminal belongs to the conversation it was opened in, not to
 * whichever dock happens to be on screen. Falling back to the primary pane for an unknown
 * id is what would leak every other conversation's shells into this one's tab strip.
 * (An id assigned to a pane that is no longer open does re-home to the primary: that pane
 * closed, but the terminal is still this scope's.)
 */
export function paneOfTerminal(id: string): DockPosition | null {
  const assigned = assignments[id];
  if (assigned === undefined) return null;
  return panes.includes(assigned) ? assigned : primaryPane();
}

/**
 * Whether this scope holds a terminal at all — the badge on the toolbar's terminal trigger
 * counts these, so it agrees with what opening the panel actually shows. Terminals the
 * other conversations hold are still live, and still listed in the toolbar's menu.
 */
export function holdsTerminal(id: string): boolean {
  return assignments[id] !== undefined;
}

/** Moves a terminal to a pane (opening it if needed) and shows it there. */
export function assignTerminalToPane(id: string, position: DockPosition): void {
  ensurePaneOpen(position);
  assignments = { ...assignments, [id]: position };
  persist();
  setPaneCurrent(position, id);
}

/**
 * Brings a terminal on screen: its pane opens (dock and all) showing it. A terminal this
 * scope does not hold — one opened in another conversation, picked from the toolbar's
 * list — joins the primary pane, which is what asking to see it here means.
 */
export function showTerminal(id: string): void {
  const position = paneOfTerminal(id);
  if (position === null) {
    assignTerminalToPane(id, primaryPane());
    return;
  }
  ensurePaneOpen(position);
  setPaneCurrent(position, id);
}

/**
 * Drops assignment entries for terminals that no longer exist — across every scope, not
 * just the one on screen: a dead shell's id would otherwise sit in an inactive
 * conversation's arrangement until that conversation aged out of storage.
 */
export function pruneAssignments(liveIds: ReadonlySet<string>): void {
  let changed = false;
  for (const [key, state] of Object.entries(scopes)) {
    const kept = Object.entries(state.assignments).filter(([id]) => liveIds.has(id));
    if (kept.length === Object.keys(state.assignments).length) continue;
    scopes = { ...scopes, [key]: { ...state, assignments: Object.fromEntries(kept) } };
    changed = true;
  }
  const kept = Object.entries(assignments).filter(([id]) => liveIds.has(id));
  if (kept.length !== Object.keys(assignments).length) {
    assignments = Object.fromEntries(kept);
    changed = true;
  }
  if (!changed) return;
  persist();
  notify();
}

// ------------------------------------------------------------------------ pane currents

export function paneCurrent(position: DockPosition): string | null {
  return currents[position] ?? null;
}

export function paneError(position: DockPosition): string | null {
  return paneErrors[position] ?? null;
}

export function setPaneError(position: DockPosition, message: string | null): void {
  if ((paneErrors[position] ?? null) === message) return;
  if (message === null) delete paneErrors[position];
  else paneErrors = { ...paneErrors, [position]: message };
  notify();
}

export function setPaneCurrent(position: DockPosition, id: string | null): void {
  if ((currents[position] ?? null) === id) {
    notify(); // assignment may still have changed alongside
    return;
  }
  if (id === null) delete currents[position];
  else currents = { ...currents, [position]: id };
  persist();
  notify();
}

/**
 * Moves a whole pane to another edge: every terminal of the source pane (and its shown
 * terminal) lands on the target, merging with anything already there; the source closes.
 *
 */
export function movePane(from: DockPosition, to: DockPosition): void {
  if (from === to) return;
  const shown = currents[from] ?? null;
  const movedIds = Object.keys(assignments).filter((id) => paneOfTerminal(id) === from);
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
  panes = panes.filter((p) => p !== from);
  delete currents[from];
  if (shown) currents = { ...currents, [to]: shown };
  persist();
  notify();
}
