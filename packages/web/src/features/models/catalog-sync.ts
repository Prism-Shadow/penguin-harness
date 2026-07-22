/**
 * One-click sync of the Project model table with the built-in catalog ("sync presets" next
 * to the search box): union semantics — catalog entries not configured locally are added;
 * entries present on both sides are reset to the catalog's fields (context window, pricing,
 * protocol, base URL, vision — the catalog wins wherever the two differ, including removing
 * pricing the catalog doesn't carry); locally added models (including user-defined groups)
 * are kept untouched. Credentials are never touched: merged rows carry no apiKey input (the
 * PUT keeps the stored key) and existing rows keep their credential display state.
 */
import { presetModelEntries } from "@prismshadow/penguin-core/model-catalog";
import type { RowState } from "./models-page";

type PresetEntry = ReturnType<typeof presetModelEntries>[number];

/** The catalog-owned fields of a row, in RowState's string-typed form (mirrors toRow). */
function presetFields(p: PresetEntry) {
  return {
    vision: p.vision !== false,
    contextWindow: p.context_window !== undefined ? String(p.context_window) : "",
    clientType: p.client_type ?? "",
    cacheRead: p.pricing ? String(p.pricing.cache_read) : "",
    cacheWrite: p.pricing ? String(p.pricing.cache_write) : "",
    output: p.pricing ? String(p.pricing.output) : "",
    baseUrl: p.base_url ?? "",
  };
}

/** A brand-new row for a catalog entry not configured locally (original: null -> added on PUT). */
function presetToRow(p: PresetEntry): RowState {
  return {
    provider: p.provider,
    modelId: p.model_id,
    original: null,
    ...presetFields(p),
    // Thinking level and output cap are user-owned, not catalog-owned (deliberately outside
    // presetFields, so a sync never clobbers them on existing rows): fresh rows inherit the
    // Agent setting.
    thinkingLevel: "",
    maxTokens: "",
    originalBaseUrl: "",
    apiKeyInput: "",
    clearApiKey: false,
  };
}

/**
 * Merges the current rows with the built-in catalog. Existing rows keep their identity,
 * credential state, and list position (fields are updated in place); catalog-only entries
 * are appended in catalog order. Returns the merged rows plus added/updated counts for the
 * success toast (updated counts only rows whose catalog-owned fields actually changed).
 */
export function syncRowsWithCatalog(
  rows: RowState[],
  preset: PresetEntry[] = presetModelEntries(),
): { rows: RowState[]; added: number; updated: number } {
  const key = (provider: string, modelId: string) => `${provider}\0${modelId}`;
  const index = new Map(rows.map((r, i) => [key(r.provider, r.modelId), i]));
  const next = [...rows];
  let added = 0;
  let updated = 0;
  for (const p of preset) {
    const i = index.get(key(p.provider, p.model_id));
    if (i === undefined) {
      next.push(presetToRow(p));
      added += 1;
      continue;
    }
    const row = next[i]!;
    const fields = presetFields(p);
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).some(
      (k) => row[k] !== fields[k],
    );
    if (changed) {
      next[i] = { ...row, ...fields };
      updated += 1;
    }
  }
  return { rows: next, added, updated };
}
