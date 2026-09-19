/**
 * Bounds on the account's keyboard shortcut overrides (`ui_prefs.keybindings`).
 *
 * `ui_prefs` is free-form JSON shallow-merged by `PUT /api/me/prefs`, so a key that holds a
 * structured document has to be bounded on the write path (the `draftShortcuts` precedent): the
 * Web App's settings page is the normal producer, but a request that never went through it must
 * not be able to store more than this either. The shape is the Web App's `StoredKeybindings`:
 * `{ v: 1, mac?: {...}, windows?: {...}, linux?: {...} }`, each section mapping a command id to a
 * chord string or null (explicitly unbound). Ids the server does not know are accepted — the
 * registry lives in the Web App and grows without a server release — as long as they fit the id
 * grammar, and chords are checked against the grammar only, never against a key list.
 */
import { HttpError } from "../http/errors.js";
import type { StoredKeybindings } from "../api/types.js";

export const KEYBINDINGS_SECTION_MAX = 64;
export const KEYBINDINGS_ID_MAX = 64;
export const KEYBINDINGS_CHORD_MAX = 48;
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

/**
 * Validates an incoming `keybindings` value and returns the normalized document to store: only
 * the known sections, only string-or-null values, nothing else riding along. Anything invalid is
 * a 400 that writes nothing, since the document is replaced whole.
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
    const clean: Record<string, string | null> = {};
    for (const [id, chord] of pairs) {
      if (id.length > KEYBINDINGS_ID_MAX || !ID_RE.test(id)) {
        throw invalid(`keybindings.${section} has an invalid command id.`);
      }
      if (chord !== null) {
        if (
          typeof chord !== "string" ||
          chord.length > KEYBINDINGS_CHORD_MAX ||
          !CHORD_RE.test(chord)
        ) {
          throw invalid(`keybindings.${section}.${id} must be null or a chord string.`);
        }
      }
      clean[id] = chord;
    }
    out[section] = clean;
  }
  if (JSON.stringify(out).length > KEYBINDINGS_BYTES_MAX) {
    throw invalid(`keybindings must serialize to at most ${KEYBINDINGS_BYTES_MAX} bytes.`);
  }
  return out;
}
