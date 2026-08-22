/**
 * Bounds on the draft screen's user-defined shortcuts (`ui_prefs.draftShortcuts`).
 *
 * `ui_prefs` is free-form JSON: `PUT /api/me/prefs` shallow-merges whatever it is handed into a
 * single TEXT column, and every other known key there holds a flag or an id. `draftShortcuts` is
 * the first key whose value is text the user wrote, so it is also the first place a client could
 * put an unbounded amount of it into a shared table. The caps are therefore enforced on the write
 * path, not only in the editor that normally produces the value: the Web App carries its own copy
 * of these numbers for its counters, and a request that never goes through that editor still
 * cannot store more than this.
 *
 * The numbers: 20 shortcuts is past the point where a click-to-pick list turns into a search
 * problem; 40 characters is what one folder row shows without truncating; 4000 characters is
 * roughly three times the longest built-in example prompt. Together they bound one user's row at
 * about 80 KB.
 */
import { HttpError } from "../http/errors.js";
import type { DraftShortcut } from "../api/types.js";

export const DRAFT_SHORTCUT_MAX_COUNT = 20;
export const DRAFT_SHORTCUT_TITLE_MAX = 40;
export const DRAFT_SHORTCUT_PROMPT_MAX = 4000;
/** Client-generated id (`sc-` + hex); the length only has to stop an id being used as storage. */
export const DRAFT_SHORTCUT_ID_MAX = 64;

function invalid(message: string): HttpError {
  return new HttpError(400, "invalid_draft_shortcuts", message);
}

/** A required, non-blank, length-capped string field of one shortcut; returns it trimmed. */
function shortcutField(
  entry: Record<string, unknown>,
  key: string,
  index: number,
  maxLen: number,
): string {
  const value = entry[key];
  if (typeof value !== "string") {
    throw invalid(`draftShortcuts[${index}].${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") throw invalid(`draftShortcuts[${index}].${key} must not be empty.`);
  if (trimmed.length > maxLen) {
    throw invalid(`draftShortcuts[${index}].${key} must be at most ${maxLen} characters.`);
  }
  return trimmed;
}

/**
 * Validates an incoming `draftShortcuts` value and returns the normalized array to store.
 *
 * Normalizing rather than passing the input through is part of the bound: the stored objects hold
 * exactly `id` / `title` / `prompt`, trimmed, so an extra key on an entry cannot ride along as
 * unbounded free storage inside a value that otherwise looks capped. Ids must be unique — they are
 * what the Web App edits and deletes a row by, and a duplicate would make those act on the wrong
 * one. Anything invalid is a 400 that writes nothing, since the array is replaced whole.
 */
export function validateDraftShortcuts(value: unknown): DraftShortcut[] {
  if (!Array.isArray(value)) throw invalid("draftShortcuts must be an array.");
  if (value.length > DRAFT_SHORTCUT_MAX_COUNT) {
    throw invalid(`draftShortcuts must hold at most ${DRAFT_SHORTCUT_MAX_COUNT} shortcuts.`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalid(`draftShortcuts[${index}] must be an object.`);
    }
    const raw = entry as Record<string, unknown>;
    const id = shortcutField(raw, "id", index, DRAFT_SHORTCUT_ID_MAX);
    if (seen.has(id)) throw invalid(`draftShortcuts[${index}].id duplicates an earlier id.`);
    seen.add(id);
    return {
      id,
      title: shortcutField(raw, "title", index, DRAFT_SHORTCUT_TITLE_MAX),
      prompt: shortcutField(raw, "prompt", index, DRAFT_SHORTCUT_PROMPT_MAX),
    };
  });
}
