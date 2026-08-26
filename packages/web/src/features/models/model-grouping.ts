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
 *
 * That automatic sequence is the DEFAULT, not the last word: every entry point takes an
 * optional `groupOrder` — the user's dragged arrangement, stored per Project by
 * model-group-order.ts — and applies it to the assembled group list. An empty order is
 * the identity, so a profile that has never dragged a group sees exactly the catalog
 * order. Storage stays out of this module: the caller loads the array and passes it in.
 */
import { MODEL_PROVIDERS } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";

import { orderModelGroups } from "./model-group-order";

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

/** The user-defined group ids present in `rows` (anything not in the catalog list), sorted by name. */
function userGroupIds(rows: readonly ModelRowLike[]): string[] {
  return [
    ...new Set(rows.map((r) => r.provider).filter((p) => !MODEL_PROVIDERS.some((k) => k.id === p))),
  ].sort();
}

/**
 * Every group key the library can show, in its automatic order: the built-in providers in
 * MODEL_PROVIDERS order — **including the ones holding no models**, which groupModelRows
 * drops from the render — then the user-defined groups. This is the sequence a group drop
 * is committed against, so a group that happens to be empty today keeps its catalog place
 * instead of arriving as a newcomer the first time a model is added to it.
 */
export function allGroupKeys(rows: readonly ModelRowLike[]): string[] {
  return [...MODEL_PROVIDERS.map((p) => p.id), ...userGroupIds(rows)];
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
 *
 * `groupOrder` then rearranges that list: groups it names take its order, groups it does
 * not keep their automatic order and TRAIL (orderModelGroups — a group the user just
 * created appears where the control that created it sits, at the bottom of the page).
 * Reordering happens before empty groups are dropped, so a stored key for a group holding
 * no models costs nothing and is not visible.
 */
export function groupModelRows<T extends ModelRowLike>(
  rows: T[],
  query: string,
  groupOrder: readonly string[] = [],
): ProviderGroup<T>[] {
  const searching = query.trim() !== "";
  const filtered = rows.filter((r) => matchesQuery(r, query));
  const builtin = MODEL_PROVIDERS.map((provider) => ({
    provider,
    rows: filtered.filter((r) => r.provider === provider.id),
  }));
  const extras = userGroupIds(filtered).map((id) => ({
    provider: userProviderInfo(id),
    rows: filtered.filter((r) => r.provider === id),
  }));
  const ordered = orderModelGroups([...builtin, ...extras], (g) => g.provider.id, groupOrder);
  return ordered.filter((g) => g.rows.length > 0 || (!searching && g.provider.id === "custom"));
}

/**
 * Flattens the library grouping into one ordered list (the chat model dropdown uses this):
 * rows ordered exactly as the model page shows them — built-in provider groups in
 * MODEL_PROVIDERS order, then user-defined groups, custom last, with `groupOrder` applied
 * on top; in-group row order preserved. Passing the page's stored order here is what keeps
 * "exactly as the model page shows them" true once a user has dragged their groups.
 */
export function orderModelsLikeLibrary<T extends ModelRowLike>(
  rows: T[],
  groupOrder: readonly string[] = [],
): T[] {
  return groupModelRows(rows, "", groupOrder).flatMap((g) => g.rows);
}

/**
 * Row shape for the configured-key filter: adds the read-only credential display and the masked
 * env-fallback preview (the DTO's ModelInfo is a superset).
 */
export interface ModelCredentialRowLike extends ModelRowLike {
  credential?: { apiKeyMasked?: string };
  /**
   * Masked preview of the env-fallback value: the server emits it only for a variable that
   * currently holds a non-empty value, so its presence is proof the environment can authenticate
   * this entry.
   */
  envKeyMasked?: string;
}

/**
 * Whether the model has an API key behind it — the single rule shared by the model library, the
 * chat model picker and the chat credential guide: a stored (masked) key **or** a masked env
 * fallback, since a user who exported the variable has configured the key just as deliberately as
 * one who typed it into the dialog. `envKey` is only the NAME of that variable and says nothing
 * about whether it is set, so it never counts on its own.
 */
export function hasConfiguredKey(m: ModelCredentialRowLike): boolean {
  return !!m.credential?.apiKeyMasked || !!m.envKeyMasked;
}

/**
 * Free model detection (drives the light-yellow "Free" badge on the model card and in the
 * chat model picker): the entry carries explicit pricing and all three buckets are 0 — covers the
 * catalog's :free variants and the openrouter/free router — while unpriced models (no pricing
 * at all, costs merely unknown) stay unbadged. Accepts the DTO's numeric pricing buckets or
 * the model page's string-typed edit fields ("" = unpriced).
 */
export function isFreeModel(
  pricing:
    | { cacheRead: number | string; cacheWrite: number | string; output: number | string }
    | undefined,
): boolean {
  if (!pricing) return false;
  return [pricing.cacheRead, pricing.cacheWrite, pricing.output].every((b) =>
    typeof b === "string" ? b.trim() !== "" && Number(b) === 0 : b === 0,
  );
}

export interface VisibleChatModelsOptions {
  /** true = list every model (the dropdown's expanded "show all" state). */
  showAll: boolean;
  query: string;
  /** Currently selected model: always visible even without a configured key (the active choice must never be invisible). */
  selected?: ModelRefValue | null;
  /** Project default model: always visible even without a configured key. */
  defaultModel?: ModelRefValue | null;
  /** The models page's stored group order; omitted = the catalog's automatic order. */
  groupOrder?: readonly string[];
}

/**
 * Candidate list for the chat model dropdown: library order → keep only models with a key
 * (hasConfiguredKey: stored or env-backed; plus the selected and the default model, unless
 * showAll) → the query then filters whatever is visible. When NO model has a key, the filter
 * degrades to showAll (everything listed), so the dropdown is never uselessly empty.
 */
export function visibleChatModels<T extends ModelCredentialRowLike>(
  models: T[],
  { showAll, query, selected, defaultModel, groupOrder }: VisibleChatModelsOptions,
): T[] {
  const ordered = orderModelsLikeLibrary(models, groupOrder);
  const keep =
    showAll || !ordered.some(hasConfiguredKey)
      ? ordered
      : ordered.filter(
          (m) => hasConfiguredKey(m) || sameModelRef(m, selected) || sameModelRef(m, defaultModel),
        );
  return keep.filter((m) => matchesQuery(m, query));
}
