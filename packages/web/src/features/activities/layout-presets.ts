/**
 * Named workspace layouts: the rail, the side panel, the open section, the player's map and
 * the run log's reasoning switch, saved together under a name so an author can switch the
 * studio between arrangements suited to writing, reviewing or media work.
 *
 * Per browser, like every other arrangement the studio remembers. Kept pure, with storage
 * passed in, so the rules are testable without a DOM; the view owns the state and applies a
 * preset through the setters the rail, the panel and the map already use.
 */
import { clampMapWidth } from "./map-split";
import {
  STUDIO_PANELS,
  clampRailWidth,
  sectionFromParam,
  type StudioPanel,
  type WorkspaceSection,
} from "./workspace-model";

export const LAYOUTS_KEY = "penguin.activityLayouts";

/** The most layouts an author may save; the built-ins do not count. */
export const MAX_SAVED_PRESETS = 20;
export const PRESET_NAME_MAX = 40;

/** Everything a layout captures. */
export interface LayoutState {
  railWidth: number;
  railCollapsed: boolean;
  sidePanel: StudioPanel | null;
  section: WorkspaceSection;
  mapWidth: number;
  mapVisible: boolean;
  showReasoning: boolean;
}

export type BuiltInPresetId = "writing" | "reviewing" | "media";

/**
 * A layout that ships with the studio. It names only what the job needs, and leaves the
 * rest as the author had it: switching to Writing should not turn reasoning back on.
 */
export interface BuiltInPreset {
  id: BuiltInPresetId;
  builtIn: true;
  state: Partial<LayoutState>;
}

/** A layout an author saved: the whole arrangement, under their own name. */
export interface SavedPreset {
  id: string;
  builtIn: false;
  name: string;
  state: LayoutState;
}

export type LayoutPreset = BuiltInPreset | SavedPreset;

/** What the key holds: the saved layouts and whether the Alt+number shortcuts are on. */
export interface LayoutStore {
  presets: SavedPreset[];
  shortcuts: boolean;
}

export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  {
    id: "writing",
    builtIn: true,
    state: {
      railWidth: 300,
      railCollapsed: false,
      sidePanel: "conversation",
      section: "description",
    },
  },
  {
    id: "reviewing",
    builtIn: true,
    state: {
      railCollapsed: true,
      sidePanel: "player",
      section: "scenes",
      mapVisible: true,
      mapWidth: 420,
    },
  },
  {
    id: "media",
    builtIn: true,
    state: { railWidth: 360, railCollapsed: false, sidePanel: null, section: "library" },
  },
];

export const EMPTY_STORE: LayoutStore = { presets: [], shortcuts: false };

/** The built-ins first, then the saved layouts in the order they were saved. */
export function allPresets(store: LayoutStore): LayoutPreset[] {
  return [...BUILT_IN_PRESETS, ...store.presets];
}

const DEFAULT_STATE: LayoutState = {
  railWidth: 300,
  railCollapsed: false,
  sidePanel: null,
  section: "description",
  mapWidth: 360,
  mapVisible: true,
  showReasoning: true,
};

/**
 * A layout read from storage, with every value brought inside what the studio accepts:
 * widths clamped, an unknown panel or section replaced. Null for something that is not a
 * layout at all.
 */
export function sanitize(value: unknown): LayoutState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const number = (key: string, fallback: number) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : fallback;
  const flag = (key: string, fallback: boolean) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;
  const panel = STUDIO_PANELS.find((key) => key === raw.sidePanel) ?? null;
  return {
    railWidth: clampRailWidth(number("railWidth", DEFAULT_STATE.railWidth)),
    railCollapsed: flag("railCollapsed", DEFAULT_STATE.railCollapsed),
    sidePanel: panel,
    section:
      sectionFromParam(typeof raw.section === "string" ? raw.section : null) ??
      DEFAULT_STATE.section,
    mapWidth: clampMapWidth(number("mapWidth", DEFAULT_STATE.mapWidth)),
    mapVisible: flag("mapVisible", DEFAULT_STATE.mapVisible),
    showReasoning: flag("showReasoning", DEFAULT_STATE.showReasoning),
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The saved layouts and the shortcut switch. Anything unreadable — blocked storage, a value
 * that is not JSON, entries that are not layouts — leaves only the built-ins, never an error.
 */
export function readPresets(storage?: Pick<Storage, "getItem">): LayoutStore {
  let parsed: unknown;
  try {
    const raw = (storage ?? localStorage).getItem(LAYOUTS_KEY);
    if (!raw) return { ...EMPTY_STORE, presets: [] };
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_STORE, presets: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ...EMPTY_STORE, presets: [] };
  const record = parsed as { presets?: unknown; shortcuts?: unknown };
  const presets: SavedPreset[] = [];
  for (const entry of Array.isArray(record.presets) ? record.presets : []) {
    if (presets.length >= MAX_SAVED_PRESETS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, state } = entry as { id?: unknown; name?: unknown; state?: unknown };
    if (typeof id !== "string" || !id || typeof name !== "string") continue;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > PRESET_NAME_MAX) continue;
    if (BUILT_IN_PRESETS.some((preset) => preset.id === id)) continue;
    if (presets.some((preset) => preset.id === id || sameName(preset.name, trimmed))) continue;
    const clean = sanitize(state);
    if (!clean) continue;
    presets.push({ id, builtIn: false, name: trimmed, state: clean });
  }
  return { presets, shortcuts: record.shortcuts === true };
}

/** Remembers the store; false when storage refused it, so the caller can keep it for the page. */
export function writePresets(store: LayoutStore, storage?: Pick<Storage, "setItem">): boolean {
  try {
    (storage ?? localStorage).setItem(
      LAYOUTS_KEY,
      JSON.stringify({
        presets: store.presets.map(({ id, name, state }) => ({ id, name, state })),
        shortcuts: store.shortcuts,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies a change to the layouts as storage holds them NOW, rather than as this page last
 * read them, and remembers the result: the key is per browser, so another tab may have saved
 * or deleted a layout since, and building on a stale copy would write over it.
 *
 * `pageCopy` stands in for storage once storage has refused a write (`fromStorage` false),
 * so a blocked browser keeps what the author did for the rest of the page. `change` returns
 * null to leave everything as it is. The result says whether storage took the write.
 */
export function commitPresets(
  pageCopy: LayoutStore,
  fromStorage: boolean,
  change: (current: LayoutStore) => LayoutStore | null,
  storage?: Pick<Storage, "getItem" | "setItem">,
): { store: LayoutStore; persisted: boolean } | null {
  const current = fromStorage ? readPresets(storage) : pageCopy;
  const next = change(current);
  if (!next) return null;
  return { store: next, persisted: writePresets(next, storage) };
}

/** Why a name or a save was refused, for the view to word. */
export type PresetError = "empty" | "tooLong" | "duplicate" | "limit" | "missing";

export type PresetResult =
  { ok: true; store: LayoutStore; preset: SavedPreset } | { ok: false; error: PresetError };

/**
 * Checks a name against the rules: 1–40 characters once trimmed, and unlike every other
 * layout's name, case aside. `reserved` holds the built-ins' names as the author sees them;
 * `except` is the layout being renamed, which may keep its own name.
 */
export function checkPresetName(
  store: LayoutStore,
  name: string,
  reserved: readonly string[],
  except?: string,
): PresetError | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > PRESET_NAME_MAX) return "tooLong";
  if (reserved.some((taken) => sameName(taken, trimmed))) return "duplicate";
  if (store.presets.some((preset) => preset.id !== except && sameName(preset.name, trimmed)))
    return "duplicate";
  return null;
}

let counter = 0;
function newPresetId(): string {
  counter += 1;
  return `layout-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Saves an arrangement under a new name, at the end of the list. */
export function savePreset(
  store: LayoutStore,
  name: string,
  state: LayoutState,
  reserved: readonly string[] = [],
  makeId: () => string = newPresetId,
): PresetResult {
  const error = checkPresetName(store, name, reserved);
  if (error) return { ok: false, error };
  if (store.presets.length >= MAX_SAVED_PRESETS) return { ok: false, error: "limit" };
  let id = makeId();
  while (store.presets.some((preset) => preset.id === id)) id = `${id}-1`;
  const clean = sanitize(state) ?? DEFAULT_STATE;
  const preset: SavedPreset = { id, builtIn: false, name: name.trim(), state: clean };
  return { ok: true, store: { ...store, presets: [...store.presets, preset] }, preset };
}

/** Renames a saved layout; a built-in is not in the store, so it cannot be renamed. */
export function renamePreset(
  store: LayoutStore,
  id: string,
  name: string,
  reserved: readonly string[] = [],
): PresetResult {
  const existing = store.presets.find((preset) => preset.id === id);
  if (!existing) return { ok: false, error: "missing" };
  const error = checkPresetName(store, name, reserved, id);
  if (error) return { ok: false, error };
  const preset: SavedPreset = { ...existing, name: name.trim() };
  return {
    ok: true,
    store: {
      ...store,
      presets: store.presets.map((entry) => (entry.id === id ? preset : entry)),
    },
    preset,
  };
}

/** Deletes a saved layout; a built-in's id matches nothing, so the store is unchanged. */
export function deletePreset(store: LayoutStore, id: string): LayoutStore {
  if (!store.presets.some((preset) => preset.id === id)) return store;
  return { ...store, presets: store.presets.filter((preset) => preset.id !== id) };
}

/** One change applying a layout makes, through the setter that piece already has. */
export type LayoutWrite =
  | { kind: "railCollapsed"; value: boolean }
  | { kind: "railWidth"; value: number }
  | { kind: "sidePanel"; value: StudioPanel | null }
  | { kind: "mapVisible"; value: boolean }
  | { kind: "mapWidth"; value: number }
  | { kind: "showReasoning"; value: boolean }
  | { kind: "section"; value: WorkspaceSection };

/**
 * The writes a layout makes, in order, clamped: only what it names, and the section last,
 * because opening a section also changes the address.
 */
export function applyOrder(state: Partial<LayoutState>): LayoutWrite[] {
  const writes: LayoutWrite[] = [];
  if (typeof state.railCollapsed === "boolean")
    writes.push({ kind: "railCollapsed", value: state.railCollapsed });
  if (typeof state.railWidth === "number")
    writes.push({ kind: "railWidth", value: clampRailWidth(state.railWidth) });
  if (state.sidePanel !== undefined)
    writes.push({
      kind: "sidePanel",
      value: STUDIO_PANELS.find((key) => key === state.sidePanel) ?? null,
    });
  if (typeof state.mapVisible === "boolean")
    writes.push({ kind: "mapVisible", value: state.mapVisible });
  if (typeof state.mapWidth === "number")
    writes.push({ kind: "mapWidth", value: clampMapWidth(state.mapWidth) });
  if (typeof state.showReasoning === "boolean")
    writes.push({ kind: "showReasoning", value: state.showReasoning });
  const section = state.section ? sectionFromParam(state.section) : null;
  if (section) writes.push({ kind: "section", value: section });
  return writes;
}

/**
 * Whether the arrangement on screen is this layout. A width that is not showing does not
 * count against it: a collapsed rail's width, or a hidden map's.
 */
export function matchesPreset(state: LayoutState, preset: LayoutPreset): boolean {
  const wanted = preset.state;
  for (const write of applyOrder(wanted)) {
    if (write.kind === "railWidth" && state.railCollapsed) continue;
    if (write.kind === "mapWidth" && !state.mapVisible) continue;
    if (state[write.kind] !== write.value) return false;
  }
  return true;
}

/** The first layout the arrangement on screen matches, or null when it matches none. */
export function currentPresetId(
  state: LayoutState,
  presets: readonly LayoutPreset[],
): string | null {
  return presets.find((preset) => matchesPreset(state, preset))?.id ?? null;
}

/**
 * The layout an Alt+number press picks (0-based), or null for any other key. Only Alt, so
 * the shortcut never shadows Ctrl or Cmd combinations; the physical digit key is read so a
 * layout where Alt changes the character still works.
 */
export function shortcutIndex(event: {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code ?? "")?.[1] ?? /^[1-9]$/.exec(event.key)?.[0];
  return digit ? Number(digit) - 1 : null;
}

/** Whether a key press lands in something the author types into, where shortcuts stay out. */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
