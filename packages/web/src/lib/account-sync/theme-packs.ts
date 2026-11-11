/**
 * The theme packs an admin imported on this server, as this browser last read them: what the
 * picker offers after the built-in packs, and the cache the pre-paint script links a stored pack
 * from — `penguin.themePacks`, the array of the server's entries exactly as `GET /api/themes`
 * answers them.
 *
 * One read store over one key. The list is read at sign-in beside the account's preferences
 * (sync.ts), again when the Appearance page mounts, and whenever this server says it changed
 * (`themes_changed`) or the event stream lost events (`resync_required`). One read is in flight at
 * a time and a second reader joins it; an answer equal to the list held keeps the very same array,
 * so nothing on screen re-renders; a failed read leaves the last list standing. A write this tab
 * made hands its result over at once ({@link acceptThemePacks}).
 *
 * The cache is not the account's: it is never synced, and it is install-scoped
 * (lib/install-scope.ts), so a browser pointed at another data root does not keep this one's packs.
 */
import { useSyncExternalStore } from "react";
import type { ThemePackDto } from "@prismshadow/penguin-server/api";
import { THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import * as api from "../../api/endpoints";
import { subscribeUserEvents } from "../amsp/user-events";
import { createReadStore, useRead, type ReadState, type ReadStorage } from "../read-store";

/** The store's one key: the list is this server's, whoever is signed in. */
const LIST = "themes";

const isString = (value: unknown): value is string => typeof value === "string";
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Every swatch colour a mode needs, as strings. */
function isSwatch(value: unknown): boolean {
  return isObject(value) && isString(value.canvas) && isString(value.ink) && isString(value.accent);
}

/**
 * Whether a cached entry has every field the pages read of it. The server answers in this shape;
 * an entry that lost a field in the browser's storage is left out rather than drawn half.
 */
function isPackEntry(value: unknown): value is ThemePackDto {
  if (!isObject(value)) return false;
  const { names, swatches, accent } = value;
  return (
    isString(value.id) &&
    isString(value.version) &&
    isString(value.v) &&
    typeof value.api === "number" &&
    (value.base === "modern" || value.base === "foundation") &&
    isObject(names) &&
    isString(names.zh) &&
    isString(names.en) &&
    isObject(swatches) &&
    isSwatch(swatches.light) &&
    isSwatch(swatches.dark) &&
    isObject(accent) &&
    isObject(accent.own) &&
    isString(accent.own.light) &&
    isString(accent.own.dark) &&
    Array.isArray(accent.presets) &&
    accent.presets.every((preset) => isObject(preset) && isString(preset.id))
  );
}

/** The cached list as stored: entries that do not read as one are dropped; nothing stored is null. */
export function parseCachedThemePacks(text: string | null): ThemePackDto[] | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isPackEntry) : null;
  } catch {
    return null;
  }
}

const storage: ReadStorage<ThemePackDto[]> = {
  load: () => parseCachedThemePacks(localStorage.getItem(THEME_STORAGE_KEYS.themePacks)),
  save: (_key, list) => localStorage.setItem(THEME_STORAGE_KEYS.themePacks, JSON.stringify(list)),
  clear: () => localStorage.removeItem(THEME_STORAGE_KEYS.themePacks),
};

const store = createReadStore<ThemePackDto[]>({ storage });

const fetchList = (): Promise<ThemePackDto[]> =>
  api.listThemePacks().then((response) => response.themes);

/**
 * Reads the list from this server, or joins the read in flight. Never rejects: a failure leaves
 * the last list standing.
 */
export function readThemePacks(): Promise<void> {
  return store.read(LIST, fetchList);
}

/**
 * Reads the list again because it changed: a read asked before the change may carry the old list,
 * so this one does not join it.
 */
export function refreshThemePacks(): Promise<void> {
  store.invalidate(LIST);
  return readThemePacks();
}

/** Takes the list a write of this tab's brought back (an import, a removal). */
export function acceptThemePacks(list: ThemePackDto[]): void {
  store.accept(LIST, list);
}

/** The list as last read, without asking: what the theme provider follows. */
export function useThemePackList(): ReadState<ThemePackDto[]> {
  return useSyncExternalStore(
    (listener) => store.subscribe(LIST, listener),
    () => store.get(LIST),
    () => store.get(LIST),
  );
}

/** The list, read again on mount unless it was just read (stale-while-revalidate). */
export function useThemePacks(): ReadState<ThemePackDto[]> {
  return useRead(store, LIST, fetchList);
}

subscribeUserEvents((event) => {
  if (event.type === "themes_changed" || event.type === "resync_required") {
    void refreshThemePacks();
  }
});
