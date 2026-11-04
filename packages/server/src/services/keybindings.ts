/**
 * Bounds on the account's keyboard shortcut overrides (`ui_prefs.keybindings`).
 *
 * `ui_prefs` is free-form JSON shallow-merged by `PUT /api/me/prefs`, so a key that holds a
 * structured document has to be bounded on the write path (the `draftShortcuts` precedent): the
 * Web App's settings page is the normal producer, but a request that never went through it must
 * not be able to store more than this either. The shape is the Web App's `StoredKeybindings`:
 * `{ v: 1, mac?: {...}, windows?: {...}, linux?: {...} }`, each section mapping a command id to
 * that command's bindings — a chord string (the one-binding form an older build writes), an
 * array of chord strings (a command can hold several), or null (explicitly unbound). Ids the
 * server does not know are accepted — the registry lives in the Web App and grows without a
 * server release — as long as they fit the id grammar, and chords are checked against the
 * grammar only, never against a key list.
 */
import { HttpError } from "../http/errors.js";
import type { StoredKeybindings, StoredKeybindingsValue } from "../api/types.js";

export const KEYBINDINGS_SECTION_MAX = 64;
export const KEYBINDINGS_ID_MAX = 64;
export const KEYBINDINGS_CHORD_MAX = 48;
/** Chords one command may hold (one id's array form; a plain string counts as one). */
export const KEYBINDINGS_CHORDS_PER_ID_MAX = 8;
/** Serialized size of the whole document. */
export const KEYBINDINGS_BYTES_MAX = 8 * 1024;

const SECTIONS = ["mac", "windows", "linux"] as const;
/** Dotted segments, each starting lower-case; camelCase inside a segment is allowed (`dock.toggleRight`). */
const ID_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
/** The Web App's chord grammar: modifier tokens in a fixed order, then a KeyboardEvent.code. */
const CHORD_RE = /^(Mod\+)?(Ctrl\+)?(Alt\+)?(Shift\+)?[A-Za-z][A-Za-z0-9]*$/;

function invalid(message: string): HttpError {
  return new HttpError(400, "invalid_keybindings", message);
}

/** One chord string under the grammar, or the reason it cannot be one. */
function checkChord(chord: unknown): string | null {
  if (typeof chord !== "string" || chord.length > KEYBINDINGS_CHORD_MAX || !CHORD_RE.test(chord)) {
    return null;
  }
  return chord;
}

/**
 * One command's value: a chord string, an array of chord strings (at most
 * `KEYBINDINGS_CHORDS_PER_ID_MAX`, an empty array reading as unbound), or null — or the reason it
 * is none of those.
 */
function validateValue(section: string, id: string, value: unknown): StoredKeybindingsValue {
  const where = `keybindings.${section}.${id}`;
  const rowMessage = `${where} must be null, a chord string or an array of chord strings.`;
  if (value === null) return null;
  if (typeof value === "string") {
    const chord = checkChord(value);
    if (chord === null) throw invalid(rowMessage);
    return chord;
  }
  if (Array.isArray(value)) {
    if (value.length > KEYBINDINGS_CHORDS_PER_ID_MAX) {
      throw invalid(`${where} must hold at most ${KEYBINDINGS_CHORDS_PER_ID_MAX} chords.`);
    }
    const chords: string[] = [];
    for (const entry of value) {
      const chord = checkChord(entry);
      if (chord === null) throw invalid(rowMessage);
      chords.push(chord);
    }
    return chords;
  }
  throw invalid(rowMessage);
}

/**
 * Validates an incoming `keybindings` value and returns the normalized document to store: only
 * the known sections, each row a chord string, an array of chord strings or null, nothing else
 * riding along — the two row forms are kept as written, so a document this build never touched
 * round-trips unchanged. Anything invalid is a 400 that writes nothing, since the document is
 * replaced whole.
 */
export function validateKeybindings(value: unknown): StoredKeybindings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("keybindings must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1) throw invalid("keybindings.v must be 1.");
  const out: StoredKeybindings = { v: 1 };
  for (const section of SECTIONS) {
    const entries = raw[section];
    if (entries === undefined) continue;
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
      throw invalid(`keybindings.${section} must be an object.`);
    }
    const pairs = Object.entries(entries as Record<string, unknown>);
    if (pairs.length > KEYBINDINGS_SECTION_MAX) {
      throw invalid(`keybindings.${section} must hold at most ${KEYBINDINGS_SECTION_MAX} entries.`);
    }
    const clean: Record<string, StoredKeybindingsValue> = {};
    for (const [id, row] of pairs) {
      if (id.length > KEYBINDINGS_ID_MAX || !ID_RE.test(id)) {
        throw invalid(`keybindings.${section} has an invalid command id.`);
      }
      clean[id] = validateValue(section, id, row);
    }
    out[section] = clean;
  }
  if (JSON.stringify(out).length > KEYBINDINGS_BYTES_MAX) {
    throw invalid(`keybindings must serialize to at most ${KEYBINDINGS_BYTES_MAX} bytes.`);
  }
  return out;
}
