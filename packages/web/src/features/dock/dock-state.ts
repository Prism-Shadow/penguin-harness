/**
 * State of the dock system, as a tiny module-level store.
 *
 * The dock is TWO surfaces — one on the right edge, one at the bottom of the chat page —
 * and every side element is a TAB in one of them: the subagents panel, the Workspace
 * files panel, the Memory panel, the Trace panel, and any number of terminals. A dock
 * shows its tabs in a strip and renders the active one; an OPEN dock with no tabs shows a
 * picker instead (choose what to open here), which is what the toolbar's two pull-open
 * buttons land on. Both docks can be open at once, and any tab can live in either dock
 * (the panel kinds are singletons — one tab per kind within a conversation — while
 * terminals are one tab per shell).
 *
 * The arrangement is SCOPED to the conversation it was made in, like each browser window
 * managing its own tabs: switching Sessions switches the whole arrangement, and no
 * conversation's tabs depend on another's. The shells behind terminal tabs are per-user
 * and keep running regardless; a scope only decides which of them are on screen here.
 * The draft page and pages with no Session use placeholder scopes; an arrangement made
 * while drafting is handed to the Session the first send creates (adoptDockScope).
 * Everything persists (one localStorage entry, least-recently-used scopes aging out), so
 * a reload restores each conversation's docks. Sizes are the exception: how wide/tall the
 * user likes a dock is one preference, not one per conversation.
 *
 * Closing a TAB removes it (the last tab closing also puts the dock away); a dock's ×
 * hides the surface keeping its tabs for the next open. Below the desktop breakpoint the
 * two docks render as ONE merged bottom surface (a 320px-minimum right panel does not fit
 * a phone); the stored arrangement splits back apart when the window widens.
 *
 * A store (rather than component state) because the consumers live far apart: the chat
 * toolbar toggles the docks, the global hotkey flips the terminal, AppLayout points the
 * scope at the route's conversation, the chat page renders the docks, and the terminal
 * list prunes dead shells' tabs on refresh.
 */

const LAYOUT_KEY = "penguin.dock.layout";
/** Scopes kept in storage; past that, the least recently touched conversations age out. */
const MAX_SCOPES = 40;

export type DockPosition = "right" | "bottom";

/** The singleton panel kinds. Terminals are the one multi-instance tab kind. */
export type PanelKind = "agents" | "workspace" | "memory" | "trace";

export const PANEL_KINDS: readonly PanelKind[] = ["agents", "workspace", "memory", "trace"];

export type DockTab =
  { kind: "panel"; panel: PanelKind } | { kind: "terminal"; terminalId: string };

/** Stable identity of a tab ("agents", …, "terminal:<id>") — the stored form. */
export function tabKey(tab: DockTab): string {
  return tab.kind === "panel" ? tab.panel : `terminal:${tab.terminalId}`;
}

function parseTabKey(key: string): DockTab | null {
  if ((PANEL_KINDS as readonly string[]).includes(key))
    return { kind: "panel", panel: key as PanelKind };
  if (key.startsWith("terminal:") && key.length > "terminal:".length)
    return { kind: "terminal", terminalId: key.slice("terminal:".length) };
  return null;
}

/**
 * The bottom dock's HEIGHT is a ratio of the chat page column. The px minimum (and the
 * ratio ceiling, which also leaves the chat room) are enforced both by the dock's CSS and
 * by the resize drag. The right dock's WIDTH is not here: it is the shared side-panel
 * width (use-panel-width.ts), unchanged from the pre-dock panels.
 */
export const DEFAULT_DOCK_HEIGHT_RATIO = 0.4;
const DOCK_RATIO_MIN = 0.15;
export const DOCK_RATIO_MAX = 0.85;
export const DOCK_MIN_HEIGHT_PX = 140;

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DOCK_HEIGHT_RATIO;
  return Math.min(DOCK_RATIO_MAX, Math.max(DOCK_RATIO_MIN, value));
}

interface DockAreaState {
  tabs: DockTab[];
  /** tabKey of the shown tab; kept pointing at a member (or null when empty). */
  active: string | null;
  /** An open dock is on screen — with tabs it shows the active one, without it shows the picker. */
  open: boolean;
}

function emptyArea(): DockAreaState {
  return { tabs: [], active: null, open: false };
}

/** One conversation's arrangement — everything setDockScope swaps. */
interface ScopeLayout {
  right: DockAreaState;
  bottom: DockAreaState;
  /** The dock touched last: the merged view's active tab follows it, and Ctrl+` targets it. */
  focus: DockPosition;
}

function emptyScope(): ScopeLayout {
  return { right: emptyArea(), bottom: emptyArea(), focus: "bottom" };
}

/**
 * The scope the dock belongs to before any conversation is open — the login screen, a
 * settings page reached directly by URL. A real Session id never collides with it. The
 * draft page instead scopes to its route id ("new" / a parked draft id), whose
 * arrangement adoptDockScope hands to the Session the first send creates.
 */
const NO_SCOPE = "~none";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : fallback;
  } catch {
    return fallback; // node env / private mode / malformed entry: start from the default
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
 * One stored dock, made safe to use. Storage is user-writable and survives across
 * versions, so a malformed entry has to degrade to an empty dock — this runs at module
 * load, where a throw would take the whole app down with it.
 */
function sanitizeArea(raw: unknown): DockAreaState {
  const area = (raw ?? {}) as Partial<{ tabs: unknown; active: unknown; open: unknown }>;
  const tabs = (Array.isArray(area.tabs) ? area.tabs : [])
    .map((key) => (typeof key === "string" ? parseTabKey(key) : null))
    .filter((tab): tab is DockTab => tab !== null);
  // One tab per key: a duplicated stored entry would render two strips fighting over one active.
  const seen = new Set<string>();
  const unique = tabs.filter((tab) => {
    const key = tabKey(tab);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const active =
    typeof area.active === "string" && unique.some((tab) => tabKey(tab) === area.active)
      ? area.active
      : unique.length > 0
        ? tabKey(unique[unique.length - 1]!)
        : null;
  return { tabs: unique, active, open: area.open === true };
}

function sanitizeScope(raw: unknown): ScopeLayout {
  const scope = (raw ?? {}) as Partial<Record<string, unknown>>;
  const right = sanitizeArea(scope.right);
  const bottom = sanitizeArea(scope.bottom);
  // A panel key present in both docks keeps the right copy (sanitizeArea dedupes only within a dock).
  const rightKeys = new Set(right.tabs.map(tabKey));
  bottom.tabs = bottom.tabs.filter((tab) => !rightKeys.has(tabKey(tab)));
  if (bottom.active !== null && !bottom.tabs.some((tab) => tabKey(tab) === bottom.active))
    bottom.active = bottom.tabs.length > 0 ? tabKey(bottom.tabs[bottom.tabs.length - 1]!) : null;
  return { right, bottom, focus: scope.focus === "right" ? "right" : "bottom" };
}

interface StoredLayout {
  scopes: Record<string, unknown>;
  bottomRatio: unknown;
}

function loadStored(): { scopes: Record<string, ScopeLayout>; bottomRatio: number } {
  const raw = readJson<Partial<StoredLayout>>(LAYOUT_KEY, {});
  const scopes: Record<string, ScopeLayout> = {};
  if (typeof raw.scopes === "object" && raw.scopes !== null) {
    for (const [key, value] of Object.entries(raw.scopes)) scopes[key] = sanitizeScope(value);
  }
  return {
    scopes,
    bottomRatio: clampRatio(typeof raw.bottomRatio === "number" ? raw.bottomRatio : NaN),
  };
}

let { scopes, bottomRatio: ratio } = loadStored();
let scope = NO_SCOPE;
// Unpacked into a local rather than read through `scopes[scope]` everywhere: the reads
// are on every render path, and one live object per scope keeps switching cheap.
let layout: ScopeLayout = scopes[scope] ?? emptyScope();

/** Whether a scope's arrangement is worth a storage entry at all. */
function scopeIsEmpty(s: ScopeLayout): boolean {
  return s.right.tabs.length === 0 && s.bottom.tabs.length === 0 && !s.right.open && !s.bottom.open;
}

/** Writes the live layout back into the scope map and persists it. */
function persist(): void {
  // An untouched scope is not worth a storage entry: visiting a conversation without ever
  // opening a dock would otherwise leave one behind for every conversation visited.
  if (scopeIsEmpty(layout)) {
    const { [scope]: _dropped, ...rest } = scopes;
    scopes = rest;
  } else {
    // Re-inserted last so key order is least-recently-touched first, which is what the cap
    // below evicts by.
    const { [scope]: _previous, ...rest } = scopes;
    scopes = { ...rest, [scope]: layout };
  }
  const keys = Object.keys(scopes);
  if (keys.length > MAX_SCOPES) {
    scopes = Object.fromEntries(keys.slice(keys.length - MAX_SCOPES).map((k) => [k, scopes[k]!]));
  }
  writeJson(LAYOUT_KEY, {
    scopes: Object.fromEntries(
      Object.entries(scopes).map(([key, s]) => [
        key,
        {
          right: { ...s.right, tabs: s.right.tabs.map(tabKey) },
          bottom: { ...s.bottom, tabs: s.bottom.tabs.map(tabKey) },
          focus: s.focus,
        },
      ]),
    ),
    bottomRatio: ratio,
  });
}

const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Monotonic change counter — subscribe with this snapshot to re-render on ANY change. */
export function dockVersion(): number {
  return version;
}

export function subscribeDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// -------------------------------------------------------------------------------- scope

/**
 * Points the dock at a conversation (or a placeholder off one). Everything on screen
 * changes with it; the shells behind terminal tabs are untouched, so switching away and
 * back costs nothing. A dock arranged before a conversation was chosen (the `~none`
 * placeholder — /chat resolves to a Session a moment after it loads) is handed to the
 * conversation that is chosen, never clobbering one that has an arrangement of its own.
 */
export function setDockScope(next: string | null): void {
  switchScope(next ?? NO_SCOPE, scope === NO_SCOPE);
}

/**
 * The draft this scope was holding has become a real Session: its arrangement moves to
 * the new id. Called at the points that turn a draft into a Session (its send paths, and
 * a self-heal renaming a session id), not on any navigation away from the draft.
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
    // The move has to reach storage here. persist() above wrote the map under the OLD
    // key; leaving it at that means a reload reads the arrangement back under a key
    // nothing routes to — and, for a draft, hands it to the next draft instead.
    writeJson(LAYOUT_KEY, {
      scopes: Object.fromEntries(
        Object.entries(scopes).map(([key, s]) => [
          key,
          {
            right: { ...s.right, tabs: s.right.tabs.map(tabKey) },
            bottom: { ...s.bottom, tabs: s.bottom.tabs.map(tabKey) },
            focus: s.focus,
          },
        ]),
      ),
      bottomRatio: ratio,
    });
  }
  scope = target;
  layout = scopes[scope] ?? emptyScope();
  notify();
}

/** The scope on screen (tests and diagnostics; components never need it). */
export function currentDockScope(): string {
  return scope;
}

// ------------------------------------------------------------------------------- narrow

/**
 * Below 1024px (the breakpoint the pre-dock panels used) the docks merge into one bottom
 * surface. The store owns the media query so every narrow-aware decision (merged active,
 * toggle semantics, the view models) lives in one place; components just render dockViews().
 */
let narrow = false;
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const query = window.matchMedia("(max-width: 1023.98px)");
  narrow = query.matches;
  query.addEventListener("change", (event) => {
    narrow = event.matches;
    notify();
  });
}

export function isNarrow(): boolean {
  return narrow;
}

// ------------------------------------------------------------------------------ getters

function area(position: DockPosition): DockAreaState {
  return layout[position];
}

function findTab(key: string): { position: DockPosition; index: number } | null {
  for (const position of ["right", "bottom"] as const) {
    const index = layout[position].tabs.findIndex((tab) => tabKey(tab) === key);
    if (index !== -1) return { position, index };
  }
  return null;
}

/** The dock a tab lives in (open or not), or null when no dock holds it. */
export function tabHome(key: string): DockPosition | null {
  return findTab(key)?.position ?? null;
}

/** Whether a dock occupies its edge. An open dock with no tabs shows the picker. */
export function isDockVisible(position: DockPosition): boolean {
  return area(position).open;
}

export function dockTabs(position: DockPosition): DockTab[] {
  return area(position).tabs;
}

export function dockActiveKey(position: DockPosition): string | null {
  return area(position).active;
}

/**
 * The merged view's active tab: the focused dock's active when that dock is on screen,
 * else the other visible dock's. What "the shown tab" means below the breakpoint.
 */
function mergedActiveKey(): string | null {
  const first = layout.focus;
  const second: DockPosition = first === "right" ? "bottom" : "right";
  if (isDockVisible(first) && area(first).active !== null) return area(first).active;
  if (isDockVisible(second)) return area(second).active;
  return null;
}

/** One renderable dock: where it sits, what its strip lists, which tab shows. */
export interface DockView {
  position: DockPosition;
  /** True for the narrow merged view (its strip spans both docks; its × hides both). */
  merged: boolean;
  tabs: DockTab[];
  activeKey: string | null;
}

/**
 * The docks to render right now. Wide: one view per open dock. Narrow: a single merged
 * bottom view listing every open dock's tabs (bottom's first — it is the surface the
 * merged view inherits). An open dock with no tabs renders its picker.
 */
export function dockViews(): DockView[] {
  if (!narrow) {
    return (["right", "bottom"] as const).filter(isDockVisible).map((position) => ({
      position,
      merged: false,
      tabs: area(position).tabs,
      activeKey: area(position).active,
    }));
  }
  if (!isDockVisible("right") && !isDockVisible("bottom")) return [];
  const tabs = [
    ...(isDockVisible("bottom") ? layout.bottom.tabs : []),
    ...(isDockVisible("right") ? layout.right.tabs : []),
  ];
  return [{ position: "bottom", merged: true, tabs, activeKey: mergedActiveKey() }];
}

/** Whether a tab is the one actually on screen (narrow-aware — what a toggle closes). */
export function isTabShown(key: string): boolean {
  const home = tabHome(key);
  if (home === null || !isDockVisible(home)) return false;
  return narrow ? mergedActiveKey() === key : area(home).active === key;
}

/** Whether a tab sits in a visible dock at all (shown or behind another tab). */
export function isTabOnScreen(key: string): boolean {
  const home = tabHome(key);
  return home !== null && isDockVisible(home);
}

// ------------------------------------------------------------------------------ actions

function activate(position: DockPosition, key: string): void {
  const state = area(position);
  state.active = key;
  state.open = true;
  layout.focus = position;
}

/** Brings an existing tab on screen: opens its dock, makes it active, focuses its dock. */
export function activateTab(key: string): void {
  const found = findTab(key);
  if (!found) return;
  activate(found.position, key);
  persist();
  notify();
}

function insertTab(tab: DockTab, position: DockPosition): void {
  const key = tabKey(tab);
  const existing = findTab(key);
  if (existing && existing.position !== position) {
    layout[existing.position].tabs = layout[existing.position].tabs.filter(
      (t) => tabKey(t) !== key,
    );
    if (layout[existing.position].active === key) {
      const rest = layout[existing.position].tabs;
      layout[existing.position].active = rest.length > 0 ? tabKey(rest[rest.length - 1]!) : null;
    }
  }
  if (!existing || existing.position !== position) {
    layout[position].tabs = [...layout[position].tabs, tab];
  }
  activate(position, key);
}

/**
 * Removes a tab wherever it lives; the dock falls back to its last remaining tab, and
 * removing the LAST tab puts the dock away — from the user's seat the × closed the
 * content, so no empty surface (nor a surprise picker) should linger.
 */
export function removeTab(key: string): void {
  const found = findTab(key);
  if (!found) return;
  const state = area(found.position);
  state.tabs = state.tabs.filter((tab) => tabKey(tab) !== key);
  if (state.active === key)
    state.active = state.tabs.length > 0 ? tabKey(state.tabs[state.tabs.length - 1]!) : null;
  if (state.tabs.length === 0) state.open = false;
  persist();
  notify();
}

/** Moves one tab to the other dock (drag / the dock pickers), activating it there. */
export function moveTab(key: string, to: DockPosition): void {
  const found = findTab(key);
  if (!found) return;
  const tab = layout[found.position].tabs[found.index]!;
  insertTab(tab, to);
  if (layout[found.position].tabs.length === 0) layout[found.position].open = false;
  persist();
  notify();
}

/** Moves a whole dock's tabs onto the other edge, after any tabs already there. */
export function moveDock(from: DockPosition, to: DockPosition): void {
  if (from === to) return;
  const source = area(from);
  if (source.tabs.length === 0) return;
  const shown = source.active;
  const target = area(to);
  target.tabs = [...target.tabs, ...source.tabs];
  source.tabs = [];
  source.active = null;
  source.open = false;
  if (shown !== null) activate(to, shown);
  else layout.focus = to;
  target.open = true;
  persist();
  notify();
}

/** Reorders one dock's strip; `keys` is the full new order of that dock's tabs. */
export function reorderDock(position: DockPosition, keys: readonly string[]): void {
  const state = area(position);
  const byKey = new Map(state.tabs.map((tab) => [tabKey(tab), tab]));
  const next = keys.map((key) => byKey.get(key)).filter((tab): tab is DockTab => tab !== undefined);
  if (next.length !== state.tabs.length) return; // a stale drag; keep the strip consistent
  if (next.every((tab, index) => tab === state.tabs[index])) return;
  state.tabs = next;
  persist();
  notify();
}

/**
 * The toolbar's two pull-open buttons: an open dock goes away (its tabs stay for the next
 * open); a closed one comes on screen — showing its tabs, or the picker when it has none.
 */
export function toggleDock(position: DockPosition): void {
  const state = area(position);
  state.open = !state.open;
  if (state.open) layout.focus = position;
  persist();
  notify();
}

/** The merged view's ×: both docks away (wide views pass their own position instead). */
export function hideView(view: DockView): void {
  if (view.merged) {
    layout.right.open = false;
    layout.bottom.open = false;
  } else {
    area(view.position).open = false;
  }
  persist();
  notify();
}

// ------------------------------------------------------------------------------- panels

/** The dock a panel's tab lives in (open or not), or null when the panel is closed. */
export function panelDock(kind: PanelKind): DockPosition | null {
  return tabHome(kind);
}

/**
 * Puts a panel on screen: adds its tab (to `position`, or where it already lives, or the
 * right dock — the default edge for panels opened from the conversation) and activates
 * it. Idempotent when already shown.
 */
export function openPanel(kind: PanelKind, position?: DockPosition): void {
  const target = position ?? panelDock(kind) ?? "right";
  insertTab({ kind: "panel", panel: kind }, target);
  persist();
  notify();
}

export function closePanel(kind: PanelKind): void {
  removeTab(kind);
}

// ---------------------------------------------------------------------------- terminals

function terminalKey(id: string): string {
  return `terminal:${id}`;
}

/** The dock a terminal's tab lives in within THIS scope, or null when it has no tab here. */
export function terminalTabDock(id: string): DockPosition | null {
  return tabHome(terminalKey(id));
}

/** This scope's terminal tabs, in strip order (bottom dock first). */
export function terminalTabIds(): string[] {
  return [...layout.bottom.tabs, ...layout.right.tabs]
    .filter((tab): tab is Extract<DockTab, { kind: "terminal" }> => tab.kind === "terminal")
    .map((tab) => tab.terminalId);
}

/**
 * Of `ids`, the ones no conversation holds — created through the API or the CLI, or whose
 * tab was closed. A dock picker's terminal row adopts one of these rather than spawning a
 * second shell beside a perfectly good one.
 */
export function unownedTerminals(ids: readonly string[]): string[] {
  const owned = new Set<string>();
  for (const s of [layout, ...Object.values(scopes)]) {
    for (const tab of [...s.right.tabs, ...s.bottom.tabs]) {
      if (tab.kind === "terminal") owned.add(tab.terminalId);
    }
  }
  return ids.filter((id) => !owned.has(id));
}

/** New terminals land at the bottom dock unless a dock asked for them explicitly. */
export function addTerminalTab(id: string, position?: DockPosition): void {
  insertTab({ kind: "terminal", terminalId: id }, position ?? terminalTabDock(id) ?? "bottom");
  persist();
  notify();
}

/**
 * Brings a terminal on screen in this conversation: its tab activates where it lives, or
 * a new tab joins the bottom dock.
 */
export function showTerminal(id: string): void {
  addTerminalTab(id);
}

/**
 * Drops tabs of terminals that no longer exist — across every scope, not just the one on
 * screen: a dead shell's id would otherwise sit in an inactive conversation's arrangement
 * until that conversation aged out of storage.
 */
export function pruneTerminalTabs(liveIds: ReadonlySet<string>): void {
  let changed = false;
  const pruneArea = (state: DockAreaState): boolean => {
    const kept = state.tabs.filter((tab) => tab.kind !== "terminal" || liveIds.has(tab.terminalId));
    if (kept.length === state.tabs.length) return false;
    state.tabs = kept;
    if (state.active !== null && !kept.some((tab) => tabKey(tab) === state.active))
      state.active = kept.length > 0 ? tabKey(kept[kept.length - 1]!) : null;
    if (kept.length === 0) state.open = false;
    return true;
  };
  for (const s of Object.values(scopes)) {
    if (s === layout) continue; // the live scope is pruned below
    if (pruneArea(s.right)) changed = true;
    if (pruneArea(s.bottom)) changed = true;
  }
  if (pruneArea(layout.right)) changed = true;
  if (pruneArea(layout.bottom)) changed = true;
  if (!changed) return;
  persist();
  notify();
}

/**
 * Ctrl+`'s toggle, on the store's synchronous half: hides the docks that hold this
 * conversation's terminal tabs when one is shown; restores/activates the newest terminal
 * tab when there are tabs but none on screen. Returns false when this scope has no
 * terminal tab at all — the caller (dock-terminal.ts) then adopts or creates a shell,
 * which is async.
 */
export function toggleTerminalDocks(): boolean {
  const ids = terminalTabIds();
  if (ids.length === 0) return false;
  const holders = (["right", "bottom"] as const).filter((position) =>
    area(position).tabs.some((tab) => tab.kind === "terminal"),
  );
  const anyShown = holders.some(
    (position) =>
      isDockVisible(position) &&
      (narrow
        ? mergedActiveKey()?.startsWith("terminal:") === true
        : area(position).active?.startsWith("terminal:") === true),
  );
  if (anyShown) {
    for (const position of holders) area(position).open = false;
    persist();
    notify();
    return true;
  }
  showTerminal(ids[ids.length - 1]!);
  return true;
}

// -------------------------------------------------------------------------------- sizes

/** The bottom dock's height, as a ratio of the chat page column (a global preference). */
export function bottomRatio(): number {
  return ratio;
}

export function setBottomRatio(next: number): void {
  const clamped = clampRatio(next);
  if (clamped === ratio) return;
  ratio = clamped;
  persist();
  notify();
}

export function resetBottomRatio(): void {
  ratio = DEFAULT_DOCK_HEIGHT_RATIO;
  persist();
  notify();
}
