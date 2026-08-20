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
 * conversation; and a dock opened before any conversation was chosen is handed to the
 * first one that is (see setDockScope).
 *
 * A side pane and the chat's Agents/Workspace panel both want the horizontal half of the
 * content area, so only one of them is on screen: whichever the user opened last. That is
 * an exclusion, not a close — the losing side keeps its arrangement and comes back when the
 * winner goes away (see setChatSidePanelOpen).
 *
 * A store (rather than component state) because the consumers live far apart: the chat
 * toolbar and the global hotkey flip visibility, AppLayout renders a pane per open edge,
 * and the drag/drop interactions inside any pane reshape the arrangement. Everything
 * persists so a reload restores panes, sizes and assignments the same way the shells
 * behind them survive server-side.
 */

/** Every scope's arrangement, in one entry: `Record<scope, DockScopeState>`. */
const DOCK_KEY = "penguin.terminal.dock";
/** How tall the user likes a pane is one preference, not one per conversation. */
const RATIOS_KEY = "penguin.terminal.dockRatios";
/** Scopes kept in storage; past that, the least recently touched conversations age out. */
const MAX_SCOPES = 40;

/** Which edge of the content area a pane occupies. */
export type DockPosition = "top" | "bottom" | "left" | "right";

const POSITIONS: readonly DockPosition[] = ["top", "bottom", "left", "right"];

/**
 * A top/bottom pane's HEIGHT is a ratio of the layout row. The px minimum (and the ratio
 * ceiling, which also leaves the main content room) are enforced both by the pane's CSS and
 * by the drag preview.
 *
 * A left/right pane's WIDTH is not here: it is the width shared with the chat's Workspace
 * and Agents panels (use-panel-width.ts), since the three take turns in the same slot.
 */
export const DEFAULT_DOCK_HEIGHT_RATIO = 0.4;
const DOCK_RATIO_MIN = 0.15;
export const DOCK_RATIO_MAX = 0.85;
export const DOCK_MIN_HEIGHT_PX = 140;

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
    // Deliberately NOT the stored value: a fresh load starts with the dock closed. The
    // ARRANGEMENT persists — panes, tabs, which terminal each showed — so reopening comes
    // back to exactly what was there; what does not persist is being open, because a
    // terminal panel unfurling on its own at startup is not something anyone asked for.
    // Within one page load it is remembered as usual: this only runs at the storage
    // boundary, and scope switches read the in-memory map.
    visible: false,
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
  // A dock opened before a conversation was chosen belongs to the one that is chosen.
  // /chat carries no Session id and resolves to one a moment after it loads (chat-page.tsx
  // redirects to the newest conversation, or to a draft), so a terminal opened in between
  // would otherwise be stranded in a scope nothing navigates back to. Only from that
  // placeholder: an ordinary switch between two conversations carries nothing across.
  switchScope(next ?? NO_SESSION_SCOPE, scope === NO_SESSION_SCOPE);
}

/**
 * The draft this scope was holding has become a real Session: its arrangement moves to the
 * new id. Every draft shares one scope, because a draft has no id to key on — so without
 * this the terminal opened while drafting stays behind under that shared key, invisible to
 * the conversation it was opened for and waiting to reappear in the NEXT draft, which is
 * the same terminal showing up in a conversation that never asked for one.
 *
 * Called at the two points that turn a draft into a Session (its send paths), not on any
 * navigation away from the draft: leaving a draft for an existing conversation must leave
 * the draft's terminals where they are.
 */
export function adoptDockScope(sessionId: string): void {
  switchScope(sessionId, true);
}

function switchScope(target: string, mayHandOver: boolean): void {
  if (target === scope) return;
  persist();
  const staged = scopes[scope];
  // Never clobbers: a target with an arrangement of its own keeps it.
  const handedOver = mayHandOver && staged !== undefined && scopes[target] === undefined;
  if (handedOver) {
    const { [scope]: _moved, ...rest } = scopes;
    scopes = { ...rest, [target]: staged };
    // The move has to reach storage here. persist() above wrote the map as it was, under the
    // OLD key; leaving it at that means a reload reads the arrangement back under a key
    // nothing routes to — and, for a draft, hands it to the next draft instead.
    writeJson(DOCK_KEY, scopes);
  }
  scope = target;
  ({ visible, panes, assignments, currents } = scopes[scope] ?? emptyScope());
  // Errors are about a pane that is no longer on screen — except after a hand-off, where
  // the panes on screen are the same ones under a new name, and a failure they are still
  // showing has not stopped being true.
  if (!handedOver) paneErrors = {};
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

/**
 * Whether the dock is on screen — which is what every caller means by "open", including the
 * toggle. A side pane displaced by a chat panel does not count: from the user's seat there
 * is no terminal, so asking for one must bring it back rather than toggle it off.
 */
export function isTerminalDockOpen(): boolean {
  return visible && visiblePanes().length > 0;
}

/**
 * Whether a pane occupies its slot in the layout: it is in the arrangement, and the user has
 * not hidden the dock. A displaced side pane still does — it stays mounted and collapses to
 * zero width so the swap animates instead of popping — which is precisely where this parts
 * ways with isTerminalDockOpen().
 */
export function paneHasSlot(position: DockPosition): boolean {
  return visible && panes.includes(position);
}

export function setTerminalDockOpen(next: boolean): void {
  if (next) terminalTakesTheSide();
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

/**
 * The arrangement: every pane the dock would show. Stable reference until it changes.
 *
 * This is NOT what to render — a side pane displaced by a chat panel is still part of the
 * arrangement, which is exactly what lets it come back. Renderers want visiblePanes().
 */
export function openPanes(): DockPosition[] {
  return panes;
}

/**
 * A chat side panel (Agents / Workspace) is on screen, displacing this dock's left and
 * right panes. Not persisted: it mirrors panel state that is itself per-visit, and a reload
 * with no panel open should show the panes again.
 */
let sidePanelDisplacing = false;

/** Whether a chat side panel currently holds the side. */
export function chatSidePanelOpen(): boolean {
  return sidePanelDisplacing;
}

export function setChatSidePanelOpen(open: boolean): void {
  if (open) cancelHandover(); // the panel is back: nothing left to hand over
  if (sidePanelDisplacing === open) return;
  sidePanelDisplacing = open;
  notify();
}

/**
 * The one duration of the side-slot choreography: a panel's retraction, a pane's collapse,
 * the sequenced swap's wait, and the exit linger all use it — they are phases of the same
 * motion, and any two drifting apart is what reads as "the old surface never left". The
 * two `duration-200` Tailwind classes (terminal-dock.tsx, files-panel.tsx) must match it;
 * CSS cannot read a JS constant.
 */
export const SIDE_SLOT_TRANSITION_MS = 200;

/**
 * The panel has been told to retract but is still on screen. The pane stays displaced for
 * that long: expanding into a slot the outgoing panel still fills keeps the total width
 * constant, and a constant total is exactly what reads as "the panel never left" — the
 * reason the panels sequence their own swaps rather than crossfading.
 */
let handingOver = false;
let handoverTimer: ReturnType<typeof setTimeout> | null = null;

function cancelHandover(): void {
  if (handoverTimer !== null) clearTimeout(handoverTimer);
  handoverTimer = null;
  handingOver = false;
}

/**
 * Called by everything that puts a terminal on screen: the terminal is what the user just
 * asked for, so it takes the side back. The chat page watches for this and retracts its
 * panels — the store cannot reach into them, and should not know they exist beyond this
 * one flag. The pane itself waits out the retraction (see handingOver) rather than
 * expanding into a slot that is still occupied.
 */
function terminalTakesTheSide(): void {
  if (!sidePanelDisplacing) return;
  sidePanelDisplacing = false; // the chat page reads this and retracts its panels
  handingOver = true;
  if (handoverTimer !== null) clearTimeout(handoverTimer);
  handoverTimer = setTimeout(() => {
    handoverTimer = null;
    handingOver = false;
    notify();
  }, SIDE_SLOT_TRANSITION_MS);
}

let visibleSnapshot: DockPosition[] = [];

/** Panes to actually render: the arrangement minus what a chat side panel is displacing. */
export function visiblePanes(): DockPosition[] {
  const next = sidePanelDisplacing || handingOver ? panes.filter(isHorizontal) : panes;
  if (next.length === panes.length) return panes; // nothing displaced: keep the stable ref
  if (next.length !== visibleSnapshot.length || next.some((p, i) => p !== visibleSnapshot[i])) {
    visibleSnapshot = next;
  }
  return visibleSnapshot;
}

/** The pane unassigned terminals belong to. */
function primaryPane(): DockPosition {
  return panes[0] ?? "bottom";
}

function ensurePaneOpen(position: DockPosition): void {
  terminalTakesTheSide();
  visible = true;
  if (!panes.includes(position)) panes = [...panes, position];
  persist();
  notify();
}

/**
 * Closes one pane. Its terminals fold back into the primary remaining pane (the shells
 * keep running server-side either way); closing the last pane hides the dock.
 *
 * Closing the LAST pane keeps the membership rather than dropping it: the shells are still
 * running, and reopening the dock has to come back to them, not spawn a replacement. There
 * is no pane left to re-home them to, so the entries stay pointed at the pane that closed —
 * paneOfTerminal() re-homes anything whose pane is not open to the primary one, which is
 * the pane that reopening creates. Terminals that were killed rather than closed leave on
 * the next pruneAssignments(), which is what finally empties the scope.
 */
export function closePane(position: DockPosition): void {
  if (!panes.includes(position)) return;
  panes = panes.filter((p) => p !== position);
  const fallback = panes[0];
  if (fallback) {
    delete currents[position];
    assignments = Object.fromEntries(
      Object.entries(assignments).map(([id, pane]) => [id, pane === position ? fallback : pane]),
    );
  } else {
    visible = false;
  }
  persist();
  notify();
}

// -------------------------------------------------------------------------------- ratios

/** A top/bottom pane's height, as a ratio of the layout row. Side panes are sized in px. */
export function paneRatio(position: DockPosition): number {
  const stored = ratios[position];
  return typeof stored === "number" ? clampRatio(stored) : DEFAULT_DOCK_HEIGHT_RATIO;
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
 * Whether this conversation holds a terminal at all — what the toolbar's badge counts, so
 * it agrees with what opening the panel shows.
 */
export function holdsTerminal(id: string): boolean {
  return assignments[id] !== undefined;
}

/**
 * Of `ids`, the ones no conversation holds — created through the API or the CLI, or left
 * behind by a conversation that let go of them. A dock opening with nothing of its own
 * adopts one of these rather than spawning a second shell beside a perfectly good one.
 */
export function unownedTerminals(ids: readonly string[]): string[] {
  const owned = new Set<string>(Object.keys(assignments)); // the live scope, ahead of `scopes`
  for (const state of Object.values(scopes)) {
    for (const id of Object.keys(state.assignments)) owned.add(id);
  }
  return ids.filter((id) => !owned.has(id));
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
  // A top<->bottom move carries the pane's height along ("keep the ratio"): the user sized
  // THIS pane, and it is the same pane on the other edge. Merges into an existing pane keep
  // the target's own size, and a side pane has no size of its own to carry — its width is
  // the shared one every side surface opens at.
  if (!panes.includes(to) && isHorizontal(from) && isHorizontal(to) && ratios[from] !== undefined) {
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
