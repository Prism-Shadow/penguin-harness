/**
 * A settings card's drafts: what each field's control holds between the stored value and the
 * card's Save, and what a Save sends. Only a field whose draft differs from its stored value is
 * sent — an untouched field would store its default as a value, pinning it against a later
 * change of the default.
 */
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";

/** A `table` field's draft: every row's cells. */
export type TableDraft = Record<string, Record<string, string | boolean>>;

/**
 * A table's draft from its stored cells (only those that differ are stored): a text cell is
 * what was saved into it, empty for the declared text (shown as the placeholder, in the page's
 * language); every other cell is its value. Sent whole: an emptied text cell goes back to the
 * declared text.
 */
export function tableDraftOf(field: PluginConfigField, stored: unknown): TableDraft {
  const saved = (stored ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return Object.fromEntries(
    (field.rows ?? []).map((row) => [
      row.id,
      Object.fromEntries(
        (field.columns ?? []).map((c) => {
          const v = saved[row.id]?.[c.name];
          if (c.type === "string") return [c.name, typeof v === "string" ? v : ""];
          return [c.name, v !== undefined ? (v as string | boolean) : row.values[c.name]!];
        }),
      ),
    ]),
  );
}

/**
 * A field's draft: strings and numbers as typed (a number stays the string in the box until
 * Save, so "1." or "-" survives the keystroke), booleans as values; a secret's clear box
 * beside it.
 */
export type Draft = Record<string, unknown>;

/** The draft a plugin's form starts from: every non-secret value as stored, every secret empty. */
export function draftOf(entry: PluginConfigEntry): Draft {
  const out: Draft = {};
  for (const [name, field] of Object.entries(entry.configuration.properties)) {
    if (field.type === "secret") continue;
    if (field.type === "table") {
      out[name] = tableDraftOf(field, entry.values[name]);
      continue;
    }
    const v = entry.values[name];
    if (v === undefined) continue;
    out[name] =
      field.type === "number"
        ? String(v)
        : field.type === "list"
          ? (Array.isArray(v) ? v : []).join("\n")
          : v;
  }
  return out;
}

/** What a field's saved value is compared with, in the draft's terms (a table as its draft). */
export function baselineOf(field: PluginConfigField, stored: unknown): unknown {
  return field.type === "table" ? tableDraftOf(field, stored) : stored;
}

/** The value a draft sends for a field: a number parsed from its box, a list split into lines, everything else as is. */
export function valueOf(field: PluginConfigField, draft: unknown): unknown {
  if (field.type === "list") {
    const lines = (typeof draft === "string" ? draft : "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    return lines.length === 0 ? null : lines;
  }
  if (field.type !== "number") return draft ?? null;
  const text = typeof draft === "string" ? draft.trim() : "";
  return text === "" ? null : Number(text);
}

/** Whether two field values are the same (lists compared by content). */
export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
