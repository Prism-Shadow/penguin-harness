/**
 * A settings card's drafts: what each field's control holds between the stored value and the
 * card's Save, and what a Save sends. Only a field whose draft differs from its stored value is
 * sent — an untouched field would store its default as a value, pinning it against a later
 * change of the default.
 */
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";

type Cells = Record<string, string | boolean>;

/**
 * A `table` field's draft: the declared rows' cells, the rows added to an `extensible` table
 * (whole), and every row's id in drawing order.
 */
export interface TableDraft {
  rows: Record<string, Cells>;
  added: Record<string, Cells>;
  order: string[];
}

/** Where an `extensible` table's added rows and order are stored (server `plugin/config.ts`). */
const ADDED = "$added";
const ORDER = "$order";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** An added row's id (server `plugin/config.ts` ROW_ID). */
const ROW_ID = /^[a-z][a-z0-9-]*$/;

type Column = NonNullable<PluginConfigField["columns"]>[number];

/** Whether a stored value fits its column — the server's `cellFits`, repeated with the reading. */
function cellFits(column: Column, value: unknown): boolean {
  if (column.type === "boolean") return typeof value === "boolean";
  if (column.type === "enum") {
    return typeof value === "string" && (column.options ?? []).some((o) => o.value === value);
  }
  return typeof value === "string";
}

/**
 * A table's draft from its stored value. A declared row's text cell is what was saved into it,
 * empty for the declared text; every other cell is its value. A locked cell, or a stored value
 * that does not fit its column, reads as declared. Added rows are taken whole when well formed
 * (an id no declared row has, every column fitting) and dropped otherwise, and the order is the
 * stored one with any row it does not name after it — the server's reading (`resolveTable`),
 * repeated here because the page draws the draft, not the server's rows.
 */
export function tableDraftOf(field: PluginConfigField, stored: unknown): TableDraft {
  const saved = isRecord(stored) ? stored : {};
  const columns = field.columns ?? [];
  const rows = Object.fromEntries(
    (field.rows ?? []).map((row) => {
      const own = isRecord(saved[row.id]) ? (saved[row.id] as Record<string, unknown>) : {};
      return [
        row.id,
        Object.fromEntries(
          columns.map((c) => {
            const v = row.locked?.includes(c.name) === true ? undefined : own[c.name];
            if (c.type === "string") return [c.name, typeof v === "string" ? v : ""];
            return [c.name, cellFits(c, v) ? (v as string | boolean) : row.values[c.name]!];
          }),
        ),
      ];
    }),
  );
  const added: Record<string, Cells> = {};
  if (field.extensible !== undefined && isRecord(saved[ADDED])) {
    const declared = new Set((field.rows ?? []).map((r) => r.id));
    for (const [id, cells] of Object.entries(saved[ADDED] as Record<string, unknown>)) {
      if (!ROW_ID.test(id) || declared.has(id) || !isRecord(cells)) continue;
      if (!columns.every((c) => cellFits(c, cells[c.name]))) continue;
      added[id] = Object.fromEntries(
        columns.map((c) => [c.name, cells[c.name] as string | boolean]),
      );
    }
  }
  const ids = [...Object.keys(rows), ...Object.keys(added)];
  const listed = field.extensible !== undefined && Array.isArray(saved[ORDER]) ? saved[ORDER] : [];
  const first = [
    ...new Set((listed as unknown[]).filter((id): id is string => ids.includes(id as string))),
  ];
  return { rows, added, order: [...first, ...ids.filter((id) => !first.includes(id))] };
}

/** What a table's draft sends: the declared rows' cells, and an extensible table's rows and order. */
function tableValueOf(field: PluginConfigField, draft: TableDraft): Record<string, unknown> {
  return field.extensible === undefined
    ? { ...draft.rows }
    : { ...draft.rows, [ADDED]: draft.added, [ORDER]: draft.order };
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

/** What a field's saved value is compared with, in the terms a save sends. */
export function baselineOf(field: PluginConfigField, stored: unknown): unknown {
  return field.type === "table" ? tableValueOf(field, tableDraftOf(field, stored)) : stored;
}

/** The value a draft sends for a field: a number parsed from its box, a list split into lines, everything else as is. */
export function valueOf(field: PluginConfigField, draft: unknown): unknown {
  if (field.type === "table") {
    return draft === undefined ? null : tableValueOf(field, draft as TableDraft);
  }
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

/** Whether an entry's `switch` field is off as drafted: its card then draws the switch alone. */
export function switchedOff(entry: PluginConfigEntry, draft: Record<string, unknown> | undefined) {
  const sw = entry.configuration.switch;
  return sw !== undefined && draft?.[sw] !== true;
}

/**
 * The fields a card draws, in declaration order: the switch alone while it is off, else every
 * field but one a table's row choice stores into (drawn only as that table's marker).
 */
export function drawnFields(
  entry: PluginConfigEntry,
  draft: Record<string, unknown> | undefined,
): Array<[string, PluginConfigField]> {
  const all = Object.entries(entry.configuration.properties);
  if (switchedOff(entry, draft)) return all.filter(([n]) => n === entry.configuration.switch);
  const choices = new Set(all.flatMap(([, f]) => (f.rowChoice ? [f.rowChoice.field] : [])));
  return all.filter(([n]) => !choices.has(n));
}
