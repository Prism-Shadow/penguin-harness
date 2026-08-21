/**
 * Add-group bulk import: turns an endpoint's model listing (POST models/list) into new
 * rows for the user-defined group being created. Every imported row carries the group's
 * endpoint config inline — base URL, the detected protocol, and the typed key when there
 * is one — matching how the config stores per-entry credentials (the bulk-key dialog
 * writes groups the same way). The listing arrives in the endpoint's own order and is kept
 * in it; entries that produce no row are counted for the toast (see buildImportedRows).
 */
import type { RowState } from "./models-page";

/** Endpoint config every imported row inherits (from the add-group dialog's fields). */
export interface GroupImportConfig {
  baseUrl: string;
  clientType: string;
  apiKey: string;
}

/**
 * Longest model id the models PUT accepts. One over-long id would 400 the whole table
 * write, so the listing is filtered here rather than letting one entry sink the import.
 */
const MAX_MODEL_ID_LENGTH = 200;

/** C0 controls and DEL: invisible on screen, but they would reach the config file and the upstream request path. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * The usable model id inside one listing entry, or null when there is none. The listing is
 * whatever the endpoint's `/models` served, so nothing in it is trusted: an entry has to
 * survive trimming, stay within the config's id bound, and carry no control characters
 * before it may become half of a `(provider, modelId)` key.
 */
function usableModelId(entry: string): string | null {
  if (typeof entry !== "string") return null;
  const modelId = entry.trim();
  if (modelId === "" || modelId.length > MAX_MODEL_ID_LENGTH) return null;
  if (CONTROL_CHARS.test(modelId)) return null;
  return modelId;
}

/** One imported row: a custom-group model with the endpoint config inline (original: null -> added on PUT). */
function importedRow(provider: string, modelId: string, config: GroupImportConfig): RowState {
  return {
    provider,
    modelId,
    original: null,
    // No vision claim until it is probed or switched on by hand — the same start a model
    // added to a user-defined group by hand gets, and the safe one: a text-only model
    // marked vision-capable is handed images directly instead of through the vision proxy.
    vision: false,
    contextWindow: "",
    maxTokens: "",
    fastMode: false,
    clientType: config.clientType,
    cacheRead: "",
    cacheWrite: "",
    output: "",
    baseUrl: config.baseUrl,
    originalBaseUrl: "",
    apiKeyInput: config.apiKey,
    clearApiKey: false,
  };
}

/**
 * Builds the rows to append for an imported listing. Nothing but the id is taken from the
 * endpoint: pricing, context window and display name stay empty, because those are
 * hand-curated fields and a provider-reported number written into them would silently
 * disagree with the catalog's own pricing convention.
 *
 * `skipped` counts the listing entries that produced no row — an unusable id (empty, over
 * the config's length bound, or carrying control characters), or a duplicate of one
 * already taken, whether earlier in the same listing or by a row already configured under
 * the same `(provider, modelId)` key (the group-name check normally guarantees the group
 * is empty; this keeps the merge correct if that ever loosens).
 */
export function buildImportedRows(
  existing: RowState[],
  groupName: string,
  listing: readonly string[],
  config: GroupImportConfig,
): { rows: RowState[]; added: number; skipped: number } {
  const key = (provider: string, modelId: string) => `${provider}\0${modelId}`;
  const seen = new Set(existing.map((r) => key(r.provider, r.modelId)));
  const rows: RowState[] = [];
  let skipped = 0;
  for (const entry of listing) {
    const modelId = usableModelId(entry);
    if (modelId === null) {
      skipped += 1;
      continue;
    }
    const k = key(groupName, modelId);
    if (seen.has(k)) {
      skipped += 1;
      continue;
    }
    seen.add(k);
    rows.push(importedRow(groupName, modelId, config));
  }
  return { rows, added: rows.length, skipped };
}
