/**
 * The built-in tools table on the Tools tab (agent-settings-page.tsx), as pure functions.
 *
 * The table is a typed form whose rows always exist: each row's permission and two number cells
 * are the draft, written together by the table's Save. A row's `call_description` switch is not
 * part of the draft — it writes at once, as "the stored table with this one row flipped" — so a
 * flip never sends, nor resets, what is being typed beside it. The table's Save in turn lays the
 * draft over the stored rows as they are at that moment, matched by name, so it never undoes a
 * flip made before it.
 *
 * A number cell left blank means the tool's default: the PUT replaces the whole table, so a
 * cleared cell drops the override. A cell holding anything must be an integer > 0 or -1.
 */
import type { ToolDefinitionConfig, ToolPermission } from "@prismshadow/penguin-core/interfaces";
import { runtimeNumberOf } from "./runtime-form";

/** One row of the table's draft. */
export interface ToolRowDraft {
  name: string;
  permission: ToolPermission | undefined;
  timeoutMs: string;
  maxOutputLength: string;
}

export type ToolNumberField = "timeoutMs" | "maxOutputLength";

const text = (n: number | undefined): string => (n === undefined ? "" : String(n));

/** The draft a stored table opens with. */
export function toolsDraftOf(tools: readonly ToolDefinitionConfig[]): ToolRowDraft[] {
  return tools.map((t) => ({
    name: t.name,
    permission: t.permission,
    timeoutMs: text(t.timeoutMs),
    maxOutputLength: text(t.maxOutputLength),
  }));
}

/** What the table's Save would send, for the dirty comparison. */
export function normalizeTools(rows: readonly ToolRowDraft[]): unknown {
  return rows.map((r) => ({
    name: r.name,
    permission: r.permission,
    timeoutMs: runtimeNumberOf(r.timeoutMs),
    maxOutputLength: runtimeNumberOf(r.maxOutputLength),
  }));
}

/** A cell's value is acceptable: blank (the default) or an integer > 0 or -1. */
function cellValid(value: string): boolean {
  const n = runtimeNumberOf(value);
  return n === undefined || (typeof n === "number" && Number.isInteger(n) && (n > 0 || n === -1));
}

/**
 * The cells at fault, as `<row name>/<field>` keys, among those that differ from the baseline
 * (null when there are none). A cell left as stored is never judged.
 */
export function toolsErrors(
  rows: readonly ToolRowDraft[],
  baseline: readonly ToolRowDraft[],
): ReadonlySet<string> | null {
  const bad = new Set<string>();
  for (const row of rows) {
    const stored = baseline.find((b) => b.name === row.name);
    for (const field of ["timeoutMs", "maxOutputLength"] as const) {
      const same =
        stored !== undefined && runtimeNumberOf(stored[field]) === runtimeNumberOf(row[field]);
      if (!same && !cellValid(row[field])) bad.add(`${row.name}/${field}`);
    }
  }
  return bad.size > 0 ? bad : null;
}

/**
 * The table the Save sends: the stored rows, each with its draft's permission and number cells
 * laid over it (a blank cell drops the override). Everything else on a row — its
 * `call_description` above all — stays as stored.
 */
export function toolsUpdateOf(
  stored: readonly ToolDefinitionConfig[],
  rows: readonly ToolRowDraft[],
): ToolDefinitionConfig[] {
  return stored.map((tool) => {
    const row = rows.find((r) => r.name === tool.name);
    if (row === undefined) return tool;
    const next: ToolDefinitionConfig = { ...tool };
    delete next.permission;
    delete next.timeoutMs;
    delete next.maxOutputLength;
    if (row.permission !== undefined) next.permission = row.permission;
    const timeout = runtimeNumberOf(row.timeoutMs);
    if (typeof timeout === "number") next.timeoutMs = timeout;
    const maxOutput = runtimeNumberOf(row.maxOutputLength);
    if (typeof maxOutput === "number") next.maxOutputLength = maxOutput;
    return next;
  });
}

/**
 * The stored table with one row's `call_description` set to `on`. A row that does not store the
 * key is already on (missing means on), so turning it on writes nothing for it.
 */
export function withCallDescription(
  stored: readonly ToolDefinitionConfig[],
  name: string,
  on: boolean,
): ToolDefinitionConfig[] {
  return stored.map((tool) => {
    if (tool.name !== name) return tool;
    if (on && tool.call_description === undefined) return tool;
    return { ...tool, call_description: on };
  });
}

/** Whether a tool's schema declares the optional `description` argument the switch governs. */
export function hasDescriptionProperty(tool: ToolDefinitionConfig): boolean {
  const props = (tool.parameters as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  return props !== undefined && props !== null && props["description"] !== undefined;
}
