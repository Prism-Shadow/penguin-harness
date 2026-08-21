/**
 * State of the dock system, as a tiny module-level store.
 *
 * The dock is TWO surfaces — one on the right edge, one on the bottom edge of the chat
 * page — and every side element is a TAB in one of them: the subagents panel, the
 * Workspace files panel, the Memory panel, the Trace panel, and any number of terminals.
 * A dock shows its tabs in a strip and renders the active one; both docks can be open at
 * once, and any tab can live in either dock (the panel kinds are singletons — one tab per
 * kind across both docks — while terminals are one tab per shell).
 *
 * The arrangement is GLOBAL, not per-conversation: tabs, active tab, open flags and sizes
 * survive Session switches and reloads (one localStorage entry). Panel tabs re-bind their
 * content to the conversation on screen; terminal tabs are the user's shells, which are
 * global to begin with. Closing a dock (its ×, or Ctrl+`) only hides it — the tabs stay,
 * so reopening comes back to the same arrangement. Closing a TAB removes it.
 *
 * Below the desktop breakpoint the two docks render as ONE merged bottom surface (a
 * 320px-minimum right panel does not fit a phone): the strip lists both docks' tabs, and
 * the merged active tab follows whichever dock was focused last. The stored arrangement is
 * untouched — widening the window splits the docks back apart exactly as they were.
 *
 * A store (rather than component state) because the consumers live far apart: the chat
 * toolbar toggles panels, the global hotkey flips the terminal, the chat page renders the
 * docks, and the terminal list prunes dead shells' tabs on refresh.
 */

const LAYOUT_KEY = "penguin.dock.layout";

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
  /** Hidden docks keep their tabs — visible = open && tabs.length > 0. */
  open: boolean;
}

function emptyArea(): DockAreaState {
  return { tabs: [], active: null, open: true };
}

interface DockLayout {
  right: DockAreaState;
  bottom: DockAreaState;
  /** The dock touched last: the merged view's active tab follows it, and Ctrl+` targets it. */
  focus: DockPosition;
  bottomRatio: number;
  /** Where each singleton panel (and new terminals) last lived, so reopening returns there. */
  homes: Partial<Record<PanelKind | "terminal", DockPosition>>;
}

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
  return { tabs: unique, active, open: area.open !== false };
}

function loadLayout(): DockLayout {
  const raw = readJson<Partial<Record<string, unknown>>>(LAYOUT_KEY, {});
  const right = sanitizeArea(raw.right);
  const bottom = sanitizeArea(raw.bottom);
  // A panel key present in both docks keeps the right copy (sanitizeArea dedupes only within a dock).
  const rightKeys = new Set(right.tabs.map(tabKey));
  bottom.tabs = bottom.tabs.filter((tab) => !rightKeys.has(tabKey(tab)));
  if (bottom.active !== null && !bottom.tabs.some((tab) => tabKey(tab) === bottom.active))
    bottom.active = bottom.tabs.length > 0 ? tabKey(bottom.tabs[bottom.tabs.length - 1]!) : null;
  const homesRaw = (typeof raw.homes === "object" && raw.homes !== null ? raw.homes : {}) as Record<
    string,
    unknown
  >;
  const homes: DockLayout["homes"] = {};
  for (const kind of [...PANEL_KINDS, "terminal"] as const) {
    const value = homesRaw[kind];
    if (value === "right" || value === "bottom") homes[kind] = value;
  }
  return {
    right,
    bottom,
    focus: raw.focus === "right" ? "right" : "bottom",
    bottomRatio: clampRatio(typeof raw.bottomRatio === "number" ? raw.bottomRatio : NaN),
    homes,
  };
}

let layout: DockLayout = loadLayout();

function persist(): void {
  writeJson(LAYOUT_KEY, {
    right: { ...layout.right, tabs: layout.right.tabs.map(tabKey) },
    bottom: { ...layout.bottom, tabs: layout.bottom.tabs.map(tabKey) },
    focus: layout.focus,
    bottomRatio: layout.bottomRatio,
    homes: layout.homes,
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

/** Whether a dock occupies its edge: it is open and holds at least one tab. */
export function isDockVisible(position: DockPosition): boolean {
  return area(position).open && area(position).tabs.length > 0;
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
  if (isDockVisible(first)) return area(first).active;
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
 * The docks to render right now. Wide: one view per visible dock. Narrow: a single merged
 * bottom view listing every visible dock's tabs (bottom's first — it is the surface the
 * merged view inherits).
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
  const tabs = [
    ...(isDockVisible("bottom") ? layout.bottom.tabs : []),
    ...(isDockVisible("right") ? layout.right.tabs : []),
  ];
  if (tabs.length === 0) return [];
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
  const homeKind = tab.kind === "panel" ? tab.panel : "terminal";
  layout.homes = { ...layout.homes, [homeKind]: position };
  activate(position, key);
}

/** Removes a tab wherever it lives; the dock falls back to its last remaining tab. */
export function removeTab(key: string): void {
  const found = findTab(key);
  if (!found) return;
  const state = area(found.position);
  state.tabs = state.tabs.filter((tab) => tabKey(tab) !== key);
  if (state.active === key)
    state.active = state.tabs.length > 0 ? tabKey(state.tabs[state.tabs.length - 1]!) : null;
  persist();
  notify();
}

/** Moves one tab to the other dock (drag / the placement actions), activating it there. */
export function moveTab(key: string, to: DockPosition): void {
  const found = findTab(key);
  if (!found) return;
  const tab = layout[found.position].tabs[found.index]!;
  insertTab(tab, to);
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
  for (const tab of source.tabs) {
    const homeKind = tab.kind === "panel" ? tab.panel : "terminal";
    layout.homes = { ...layout.homes, [homeKind]: to };
  }
  source.tabs = [];
  source.active = null;
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
 * Hides or restores a dock. Hiding keeps the tabs — the dock's × and Ctrl+` are "put it
 * away", not "tear it down"; individual tabs close through removeTab.
 */
export function setDockOpen(position: DockPosition, open: boolean): void {
  if (area(position).open === open) return;
  area(position).open = open;
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

function panelDefault(kind: PanelKind): DockPosition {
  return layout.homes[kind] ?? "right";
}

/** The dock a panel's tab lives in (open or not), or null when the panel is closed. */
export function panelDock(kind: PanelKind): DockPosition | null {
  return tabHome(kind);
}

/**
 * Puts a panel on screen: adds its tab (to `position`, or its remembered home, or the
 * right dock), moves it when it already lives in the other dock and a position was asked
 * for, and activates it. Idempotent when already shown.
 */
export function openPanel(kind: PanelKind, position?: DockPosition): void {
  const target = position ?? panelDock(kind) ?? panelDefault(kind);
  insertTab({ kind: "panel", panel: kind }, target);
  persist();
  notify();
}

export function closePanel(kind: PanelKind): void {
  removeTab(kind);
}

/**
 * The toolbar's click: the shown panel closes; anything else (behind another tab, in a
 * hidden dock, or closed) comes to the front.
 */
export function togglePanel(kind: PanelKind): void {
  if (isTabShown(kind)) closePanel(kind);
  else openPanel(kind);
}

// ---------------------------------------------------------------------------- terminals

function terminalKey(id: string): string {
  return `terminal:${id}`;
}

/** New terminals land at the remembered terminal home, defaulting to the bottom dock. */
export function terminalDefaultDock(): DockPosition {
  return layout.homes.terminal ?? "bottom";
}

/** The dock a terminal's tab lives in (open or not), or null when it has no tab. */
export function terminalTabDock(id: string): DockPosition | null {
  return tabHome(terminalKey(id));
}

/** Every terminal that has a tab, in strip order (bottom dock first). */
export function terminalTabIds(): string[] {
  return [...layout.bottom.tabs, ...layout.right.tabs]
    .filter((tab): tab is Extract<DockTab, { kind: "terminal" }> => tab.kind === "terminal")
    .map((tab) => tab.terminalId);
}

export function addTerminalTab(id: string, position?: DockPosition): void {
  insertTab({ kind: "terminal", terminalId: id }, position ?? terminalDefaultDock());
  persist();
  notify();
}

/**
 * Brings a terminal on screen: its tab activates where it lives, or a new tab joins the
 * terminal home dock — which is what asking to see a shell opened elsewhere means.
 */
export function showTerminal(id: string): void {
  addTerminalTab(id, terminalTabDock(id) ?? terminalDefaultDock());
}

/** Drops tabs of terminals that no longer exist (a dead shell's tab is nothing to show). */
export function pruneTerminalTabs(liveIds: ReadonlySet<string>): void {
  let changed = false;
  for (const position of ["right", "bottom"] as const) {
    const state = area(position);
    const kept = state.tabs.filter((tab) => tab.kind !== "terminal" || liveIds.has(tab.terminalId));
    if (kept.length === state.tabs.length) continue;
    state.tabs = kept;
    if (state.active !== null && !kept.some((tab) => tabKey(tab) === state.active))
      state.active = kept.length > 0 ? tabKey(kept[kept.length - 1]!) : null;
    changed = true;
  }
  if (!changed) return;
  persist();
  notify();
}

/**
 * Ctrl+`'s toggle, on the store's synchronous half: hides the docks that hold terminal
 * tabs when any of them is on screen; restores/activates the newest terminal tab when
 * there are tabs but none on screen. Returns false when there is no terminal tab at all —
 * the caller (dock-terminal.ts) then adopts or creates a shell, which is async.
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

/** The bottom dock's height, as a ratio of the chat page column. */
export function bottomRatio(): number {
  return layout.bottomRatio;
}

export function setBottomRatio(next: number): void {
  const clamped = clampRatio(next);
  if (clamped === layout.bottomRatio) return;
  layout.bottomRatio = clamped;
  persist();
  notify();
}

export function resetBottomRatio(): void {
  layout.bottomRatio = DEFAULT_DOCK_HEIGHT_RATIO;
  persist();
  notify();
}
