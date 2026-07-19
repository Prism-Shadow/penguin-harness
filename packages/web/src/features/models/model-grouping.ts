/**
 * Search filtering and grouping-by-provider for the models page (pure functions, easy to
 * unit test): grouping uses the entry's **provider field** directly ((provider, model_id) is
 * the entry's unique key, with no `<provider>/<id>` concatenation anywhere in the pipeline).
 * A provider not in the catalog list is a **user-defined group**: each
 * forms its own group, keeping its original value, with OpenAI protocol semantics (env
 * fallback OPENAI_*), sorted by name and appended after custom. Matches model_id /
 * display name / provider / vendor name case-insensitively; built-in group order follows
 * the MODEL_PROVIDERS definition. Empty groups aren't returned, except the custom group,
 * which is always shown when there's no search query (rendered even when empty, to host
 * the generic "add model" entry point).
 */
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";

/** Paired model reference (same shape as the server DTO's ModelRefDto; a model is always referenced as (provider, modelId)). */
export interface ModelRefValue {
  provider: string;
  modelId: string;
}

/** Paired-reference equality (the sole comparison standard; either side missing counts as unequal). */
export function sameModelRef(
  a: ModelRefValue | null | undefined,
  b: ModelRefValue | null | undefined,
): boolean {
  return !!a && !!b && a.provider === b.provider && a.modelId === b.modelId;
}

/** Minimal row shape needed for grouping/filtering (models-page's RowState and the DTO's ModelInfo are both supersets of this). */
export interface ModelRowLike {
  /** Vendor id (entry field): a value not in the catalog list is a user-defined group, forming its own group while keeping its original value. */
  provider: string;
  /** Upstream model id (i.e. the stored model_id). */
  modelId: string;
  displayName?: string;
}

/** Synthesized vendor info for a user-defined group: OpenAI protocol semantics (env fallback OPENAI_*), no external links or gateway endpoint. */
export function userProviderInfo(id: string): ModelProviderInfo {
  return { id, label: id, envKey: "OPENAI_API_KEY", envBaseUrlKey: "OPENAI_BASE_URL" };
}

/** Case-insensitive match against model_id / display name / raw provider value / vendor display name; empty query always matches. */
export function matchesQuery(row: ModelRowLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const provider = MODEL_PROVIDERS.find((p) => p.id === row.provider);
  return (
    row.modelId.toLowerCase().includes(q) ||
    (row.displayName ?? "").toLowerCase().includes(q) ||
    row.provider.toLowerCase().includes(q) ||
    (provider?.label ?? "").toLowerCase().includes(q)
  );
}

export interface ProviderGroup<T extends ModelRowLike> {
  provider: ModelProviderInfo;
  rows: T[];
}

/**
 * Filter + group by vendor; rows within a group keep their original order. Built-in groups
 * follow MODEL_PROVIDERS order (the custom group is returned even when empty, when there's
 * no search query); user-defined groups each form their own group, sorted by name and
 * appended after custom.
 */
export function groupModelRows<T extends ModelRowLike>(
  rows: T[],
  query: string,
): ProviderGroup<T>[] {
  const searching = query.trim() !== "";
  const filtered = rows.filter((r) => matchesQuery(r, query));
  const builtin = MODEL_PROVIDERS.map((provider) => ({
    provider,
    rows: filtered.filter((r) => r.provider === provider.id),
  }));
  const extraIds = [
    ...new Set(
      filtered.map((r) => r.provider).filter((p) => !MODEL_PROVIDERS.some((k) => k.id === p)),
    ),
  ].sort();
  const extras = extraIds.map((id) => ({
    provider: userProviderInfo(id),
    rows: filtered.filter((r) => r.provider === id),
  }));
  return [...builtin, ...extras].filter(
    (g) => g.rows.length > 0 || (!searching && g.provider.id === "custom"),
  );
}
