/**
 * The resolved keymap and where the user's overrides live.
 *
 * Resolution = the registry's defaults for the current platform, overlaid by the stored
 * platform section's known ids (`null` = explicitly unbound). The stored document is the
 * account's `ui_prefs.keybindings`, mirrored to `localStorage["penguin.keybindings"]`: the
 * dispatcher installs at module evaluation, before auth and before any prefs request answers,
 * so the first keystroke needs a synchronous read, and the mirror's `storage` event is what
 * lets every other same-origin tab follow a change live. Only overrides are stored — a row set
 * back to its default is deleted from the section, so a later default change reaches users who
 * never touched that row — and ids the registry does not know are carried through untouched.
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

function storage(): KeybindingsStorage | null {
  if (storageOverride !== null) return storageOverride;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access denied (sandboxed frame, disabled storage)
  }
}

/**
 * The document shape, enforced: `v` must be 1 and only the three platform sections are kept,
 * each holding string-or-null values. Chord grammar is NOT checked here — an unparseable chord
 * is skipped at apply time and kept in the document, like an unknown id.
 */
export function sanitizeStored(value: unknown): StoredKeybindings {
  if (typeof value !== "object" || value === null || (value as { v?: unknown }).v !== 1) {
    return { v: 1 };
  }
  const out: StoredKeybindings = { v: 1 };
  for (const section of SECTIONS) {
    const raw = (value as Record<string, unknown>)[section];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entries: Record<string, string | null> = {};
    for (const [id, chord] of Object.entries(raw as Record<string, unknown>)) {
      if (chord === null || typeof chord === "string") entries[id] = chord;
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

function writeStored(doc: StoredKeybindings): void {
  const compact: StoredKeybindings = { v: 1 };
  for (const section of SECTIONS) {
    const entries = doc[section];
    if (entries !== undefined && Object.keys(entries).length > 0) compact[section] = entries;
  }
  try {
    storage()?.setItem(KEYBINDINGS_KEY, JSON.stringify(compact));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
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

function resolve(platform: Platform): Keymap {
  const section = readStored()[platform] ?? {};
  const out = new Map<CommandId, Chord | null>();
  for (const cmd of SHORTCUT_COMMANDS) {
    const fallback = effectiveDefault(cmd, platform);
    if (!Object.hasOwn(section, cmd.id)) {
      out.set(cmd.id, fallback);
      continue;
    }
    const stored = section[cmd.id];
    if (stored === null || stored === undefined) {
      out.set(cmd.id, null);
      continue;
    }
    const parsed = parseChord(stored);
    out.set(cmd.id, parsed === null ? fallback : normalizeChord(parsed, platform));
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

export function bindingOf(id: CommandId): Chord | null {
  return keymap().get(id) ?? null;
}

/** True while the stored platform section carries an entry for the id (including an explicit unbind). */
export function isOverridden(id: CommandId): boolean {
  const section = readStored()[currentPlatform()];
  return section !== undefined && Object.hasOwn(section, id);
}

/** Binds (or, with null, unbinds) a command; a chord equal to the default removes the override instead. */
export function setBinding(id: CommandId, chord: Chord | null): void {
  const platform = currentPlatform();
  const doc = readStored();
  const section = { ...(doc[platform] ?? {}) };
  const normalized = chord === null ? null : normalizeChord(chord, platform);
  if (chordEquals(normalized, effectiveDefault(commandById(id), platform))) {
    delete section[id];
  } else {
    section[id] = normalized === null ? null : serializeChord(normalized);
  }
  writeStored({ ...doc, [platform]: section });
}

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
