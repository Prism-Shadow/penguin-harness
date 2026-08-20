/**
 * Add-group bulk import: turns an endpoint's model listing (POST models/list) into new
 * rows for the user-defined group being created. Every imported row carries the group's
 * endpoint config inline — base URL, the detected protocol, and the typed key when there
 * is one — matching how the config stores per-entry credentials (the bulk-key dialog
 * writes groups the same way). The listing arrives in the endpoint's own order and is
 * kept in it; ids already present (a duplicate inside the listing, or an existing row on
 * a re-import) are skipped and counted for the toast.
 */
import type { RowState } from "./models-page";

/** Endpoint config every imported row inherits (from the add-group dialog's fields). */
export interface GroupImportConfig {
  baseUrl: string;
  clientType: string;
  apiKey: string;
}

/** One imported row: a custom-group model with the endpoint config inline (original: null -> added on PUT). */
function importedRow(provider: string, modelId: string, config: GroupImportConfig): RowState {
  return {
    provider,
    modelId,
    original: null,
    // Supported by default (custom-model semantics): rowToEntry then omits the field.
    vision: true,
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
 * Builds the rows to append for an imported listing. `skipped` counts ids dropped as
 * duplicates — within the listing itself, or against rows already configured under any
 * group with the same `(provider, modelId)` key (the group-name check normally guarantees
 * the group is empty; this keeps the merge correct if that ever loosens).
 */
export function buildImportedRows(
  existing: RowState[],
  groupName: string,
  listing: string[],
  config: GroupImportConfig,
): { rows: RowState[]; added: number; skipped: number } {
  const key = (provider: string, modelId: string) => `${provider}\0${modelId}`;
  const seen = new Set(existing.map((r) => key(r.provider, r.modelId)));
  const rows: RowState[] = [];
  let skipped = 0;
  for (const modelId of listing) {
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
