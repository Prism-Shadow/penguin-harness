/**
 * The resolved keymap and where the user's overrides live.
 *
 * A command holds a LIST of bindings: the registry's default plus whatever the user added, in
 * binding order (the default first, additions oldest-first). Resolution = the registry's
 * defaults for the current platform, overlaid by the stored platform section's known ids: a row
 * replaces the whole list (null or an empty list = explicitly unbound; a lone chord string — the
 * one-binding form an older build writes — reads as a one-element list). The stored document is
 * the account's `ui_prefs.keybindings`, mirrored to `localStorage["penguin.keybindings"]`: the
 * dispatcher installs at module evaluation, before auth and before any prefs request answers,
 * so the first keystroke needs a synchronous read, and the mirror's `storage` event is what
 * lets every other same-origin tab follow a change live. Only overrides are stored — a list set
 * back to just the default is deleted from the section, so a later default change reaches users
 * who never touched that row — and ids the registry does not know are carried through untouched.
 *
 * Storage is injectable (the install-scope.ts convention: vitest runs in Node with no
 * localStorage), and every read degrades to the defaults on anything unexpected.
 */
import { chordEquals, normalizeChord, parseChord, serializeChord } from "./chord";
import { relocateChord } from "./match";
import { currentPlatform } from "./platform";
import { SHORTCUT_COMMANDS, commandById, defaultChord } from "./registry";
import type {
  Chord,
  CommandId,
  Keymap,
  Platform,
  ShortcutCommand,
  StoredKeybindings,
  StoredKeybindingsValue,
} from "./types";

/** The browser mirror of the account's overrides (a `browser`-scoped key in install-scope's KEY_RULES). */
export const KEYBINDINGS_KEY = "penguin.keybindings";

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface KeybindingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SECTIONS: readonly Platform[] = ["mac", "windows", "linux"];

let storageOverride: KeybindingsStorage | null = null;
let layout: ReadonlyMap<string, string> | null = null;
let cache: { platform: Platform; keymap: Keymap } | null = null;
let version = 0;
const listeners = new Set<() => void>();
/** Whether this tab edited the bindings since it loaded: what decides an absent server copy's fate on hydrate. */
let writtenThisSession = false;
/** Where a write goes after the mirror: the account's prefs, installed once the session is signed in. */
let persister: ((doc: StoredKeybindings) => void) | null = null;

function storage(): KeybindingsStorage | null {
  if (storageOverride !== null) return storageOverride;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access denied (sandboxed frame, disabled storage)
  }
}

/** One row's stored form, or undefined when the row cannot be one (kept out, like an unknown shape). */
function sanitizeRowValue(value: unknown): StoredKeybindingsValue | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const chords: string[] = [];
    for (const entry of value) {
      // Chord grammar is NOT checked here — an unparseable chord is skipped at apply time and
      // kept in the document, like an unknown id.
      if (typeof entry === "string") chords.push(entry);
    }
    return chords;
  }
  return undefined;
}

/**
 * The document shape, enforced: `v` must be 1 and only the three platform sections are kept, each
 * holding rows of chord strings, arrays of chord strings or null. Chord grammar is NOT checked
 * here — an unparseable chord is skipped at apply time and kept in the document, like an unknown
 * id.
 */
export function sanitizeStored(value: unknown): StoredKeybindings {
  if (typeof value !== "object" || value === null || (value as { v?: unknown }).v !== 1) {
    return { v: 1 };
  }
  const out: StoredKeybindings = { v: 1 };
  for (const section of SECTIONS) {
    const raw = (value as Record<string, unknown>)[section];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entries: Record<string, StoredKeybindingsValue> = {};
    for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
      const clean = sanitizeRowValue(row);
      if (clean !== undefined) entries[id] = clean;
    }
    out[section] = entries;
  }
  return out;
}

/** The stored document; malformed JSON, a foreign shape or a wrong `v` all read as "no overrides". */
export function readStored(store: KeybindingsStorage | null = storage()): StoredKeybindings {
  try {
    const raw = store?.getItem(KEYBINDINGS_KEY);
    if (raw === null || raw === undefined || raw === "") return { v: 1 };
    return sanitizeStored(JSON.parse(raw));
  } catch {
    return { v: 1 };
  }
}

/** The document without empty sections, which is the form both the mirror and the server hold. */
function compactDoc(doc: StoredKeybindings): StoredKeybindings {
  const compact: StoredKeybindings = { v: 1 };
  for (const section of SECTIONS) {
    const entries = doc[section];
    if (entries !== undefined && Object.keys(entries).length > 0) compact[section] = entries;
  }
  return compact;
}

function storeMirror(compact: StoredKeybindings): void {
  try {
    storage()?.setItem(KEYBINDINGS_KEY, JSON.stringify(compact));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/** A user edit: mirror first, so it applies at once here and in every other tab, then the account. */
function writeStored(doc: StoredKeybindings): void {
  const compact = compactDoc(doc);
  storeMirror(compact);
  writtenThisSession = true;
  persister?.(compact);
  invalidate();
}

/**
 * Installs (or, with null, removes) the writer that carries an edit to the account's prefs. The
 * store stays free of the API client: the runtime that knows the session is signed in installs
 * it, and nothing is sent before then. Either call is an account boundary — sign-out is
 * client-side and reloads nothing — so the "edited this session" mark starts over here: an edit
 * made under the previous account must never be read as pending for the next one.
 */
export function setKeybindingsPersister(fn: ((doc: StoredKeybindings) => void) | null): void {
  persister = fn;
  writtenThisSession = false;
}

/**
 * Reconciles the mirror with the account's copy once it arrives. The server wins: its document
 * replaces the mirror. An absent server copy means one of two things — this account edited the
 * bindings in this tab before the prefs answered, in which case the mirror is that edit and
 * stays (the persister already carried it, so nothing is sent again); or nothing was ever stored
 * for this account, in which case the mirror is cleared, so a browser that signs into another
 * account does not resurrect the previous account's bindings.
 */
export function hydrateFromServer(stored: unknown): void {
  if (stored !== undefined && stored !== null) {
    storeMirror(compactDoc(sanitizeStored(stored)));
    invalidate();
    return;
  }
  if (writtenThisSession) return;
  storage()?.removeItem(KEYBINDINGS_KEY);
  invalidate();
}

function invalidate(): void {
  cache = null;
  version++;
  for (const listener of [...listeners]) listener();
}

/** The registry default after the keyboard layout relocation, when a layout is known. */
function effectiveDefault(cmd: ShortcutCommand, platform: Platform): Chord | null {
  const chord = defaultChord(cmd, platform);
  return chord !== null && layout !== null ? relocateChord(chord, layout) : chord;
}

/** One stored row as the parsed binding list: a lone string reads as one chord, null as none. */
function rowBindings(
  row: StoredKeybindingsValue,
  fallback: Chord | null,
  platform: Platform,
): readonly Chord[] {
  if (row === null) return [];
  const texts = typeof row === "string" ? [row] : row;
  const chords: Chord[] = [];
  for (const text of texts) {
    const parsed = parseChord(text);
    if (parsed !== null) chords.push(normalizeChord(parsed, platform));
  }
  // A row whose every chord fails the grammar reads as no override at all.
  return chords.length > 0 ? chords : fallback === null ? [] : [fallback];
}

function resolve(platform: Platform): Keymap {
  const section = readStored()[platform] ?? {};
  const out = new Map<CommandId, readonly Chord[]>();
  for (const cmd of SHORTCUT_COMMANDS) {
    const fallback = effectiveDefault(cmd, platform);
    const initial: readonly Chord[] = fallback === null ? [] : [fallback];
    // A row value is never undefined, so this one check covers an absent row and a row
    // sanitizeStored dropped alike — and is what narrows under noUncheckedIndexedAccess.
    const row = section[cmd.id];
    out.set(cmd.id, row === undefined ? initial : rowBindings(row, fallback, platform));
  }
  return out;
}

/** The keymap for the current platform; cached until a write, a `storage` event or a layout arrives. */
export function keymap(): Keymap {
  const platform = currentPlatform();
  if (cache === null || cache.platform !== platform)
    cache = { platform, keymap: resolve(platform) };
  return cache.keymap;
}

/** The command's bindings, in binding order; empty while the command is unbound. */
export function bindingsOf(id: CommandId): readonly Chord[] {
  return keymap().get(id) ?? [];
}

/** True while the stored platform section carries an entry for the id (including an explicit unbind). */
export function isOverridden(id: CommandId): boolean {
  const section = readStored()[currentPlatform()];
  return section !== undefined && Object.hasOwn(section, id);
}

/**
 * Writes the command's whole binding list as its row. A list equal to just the default leaves no
 * row (a later default change must still reach the user); an empty list stores the explicit
 * unbind (null), so nothing fires until a binding is added again or the row is reset; anything
 * else is the list serialized.
 */
function writeBindings(id: CommandId, list: readonly Chord[]): void {
  const platform = currentPlatform();
  const doc = readStored();
  const section = { ...(doc[platform] ?? {}) };
  const fallback = effectiveDefault(commandById(id), platform);
  const backToDefault = fallback !== null && list.length === 1 && chordEquals(list[0]!, fallback);
  if (list.length === 0) section[id] = null;
  else if (backToDefault) delete section[id];
  else section[id] = list.map(serializeChord);
  writeStored({ ...doc, [platform]: section });
}

/**
 * Adds a binding to a command: the chord joins the list (the default keeps working), and an
 * already-bound chord is a no-op. This is the recorder's commit — adding never replaces.
 */
export function addBinding(id: CommandId, chord: Chord): void {
  const platform = currentPlatform();
  const normalized = normalizeChord(chord, platform);
  const list = bindingsOf(id);
  if (list.some((bound) => chordEquals(bound, normalized))) return;
  writeBindings(id, [...list, normalized]);
}

/**
 * Removes one binding from a command (the default chord can be removed like any other). A list
 * that falls back to just the default leaves no row; an empty list stores the explicit unbind.
 */
export function removeBinding(id: CommandId, chord: Chord): void {
  const platform = currentPlatform();
  const normalized = normalizeChord(chord, platform);
  const list = bindingsOf(id);
  const index = list.findIndex((bound) => chordEquals(bound, normalized));
  if (index < 0) return;
  writeBindings(
    id,
    list.filter((_, i) => i !== index),
  );
}

/**
 * Unbinds a command outright (the recorder's Backspace): the row is null, so nothing fires until
 * a binding is added again or the row is reset.
 */
export function unbindCommand(id: CommandId): void {
  writeBindings(id, []);
}

/** Drops the command's row entirely, so the registry default applies again. */
export function resetBinding(id: CommandId): void {
  const platform = currentPlatform();
  const doc = readStored();
  const section = { ...(doc[platform] ?? {}) };
  delete section[id];
  writeStored({ ...doc, [platform]: section });
}

/** Drops every override of the current platform; the other platforms' sections stay. */
export function resetAll(): void {
  const doc = readStored();
  delete doc[currentPlatform()];
  writeStored(doc);
}

/** The mirror changed underneath us (another tab's `storage` event, or a whole-store clear): re-read on the next access. */
export function noteExternalChange(key: string | null): void {
  if (key === null || key === KEYBINDINGS_KEY) invalidate();
}

/** `useSyncExternalStore` pair: subscribe, and a version that changes whenever the keymap may have. */
export function subscribeKeymap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function keymapVersion(): number {
  return version;
}

/**
 * The browser's `code → character` map, when it exposes one: defaults move to the key that types
 * their US character, and labels show the character a key actually types.
 */
export function applyKeyboardLayout(map: ReadonlyMap<string, string> | null): void {
  layout = map;
  invalidate();
}

export function keyboardLayout(): ReadonlyMap<string, string> | null {
  return layout;
}

/** Tests inject a storage and a layout; both null restores the browser defaults. */
export function configureKeybindingsStoreForTests(options: {
  storage?: KeybindingsStorage | null;
  layout?: ReadonlyMap<string, string> | null;
}): void {
  if (options.storage !== undefined) storageOverride = options.storage;
  if (options.layout !== undefined) layout = options.layout;
  writtenThisSession = false;
  persister = null;
  invalidate();
}

interface NavigatorKeyboard {
  keyboard?: {
    getLayoutMap?: () => Promise<{ forEach(cb: (value: string, key: string) => void): void }>;
  };
}

if (typeof window !== "undefined") {
  // Another tab wrote the mirror (the event never fires in the writing tab; writeStored notifies that one itself).
  window.addEventListener("storage", (event) => noteExternalChange(event.key));
  // Chromium and Electron expose the layout; Firefox and Safari do not and keep US positions.
  const keyboard = (navigator as NavigatorKeyboard).keyboard;
  keyboard
    ?.getLayoutMap?.()
    .then((map) => {
      const copy = new Map<string, string>();
      map.forEach((value, key) => copy.set(key, value));
      applyKeyboardLayout(copy);
    })
    .catch(() => {});
}
