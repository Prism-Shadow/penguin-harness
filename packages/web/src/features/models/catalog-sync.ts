/**
 * One-click sync of the Project model table with the built-in catalog ("sync presets" next
 * to the search box): union semantics — catalog entries not configured locally are added;
 * entries present on both sides are reset to the catalog's fields (context window, pricing,
 * protocol, base URL, vision — the catalog wins wherever the two differ, including removing
 * pricing the catalog doesn't carry); locally added models (including user-defined groups)
 * are kept untouched. Credentials are never touched: merged rows carry no apiKey input (the
 * PUT keeps the stored key) and existing rows keep their credential display state.
 *
 * The display name is the one catalog field that is filled but never overwritten — see
 * {@link displayNameFill}.
 */
import { catalogEntryFor, presetModelEntries } from "@prismshadow/penguin-core/model-catalog";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import type { RowState } from "./models-page";

type PresetEntry = ReturnType<typeof presetModelEntries>[number];

/** One saved model entry, as the models endpoint sends it. */
type ModelDto = ModelsResponse["models"][number];

/** The catalog-owned fields, in the string-typed form both sides are compared in. */
type CatalogFields = ReturnType<typeof presetFields>;

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

/**
 * The name a sync writes onto an entry that currently shows `current`, or undefined to leave it
 * alone (`undefined` for `current` is a brand-new row, which shows nothing yet).
 *
 * Fill-only, unlike every field in `presetFields`: a stored name may be the user's own rename,
 * which the catalog has no claim to, while a blank one (never set, or cleared on disk and
 * reported as "") leaves the row labelled by its raw model id and is worth repairing. The cost
 * of that trade is that a deliberately cleared name comes back on the next sync.
 *
 * The name comes from the catalog rather than from `p`: `presetModelEntries` emits the
 * PERSISTED entry shape, whose `display_name` is only written when it differs from the
 * catalog, so a preset entry never carries one. Every catalog entry is named
 * (`ModelCatalogEntry.displayName` is required), so the undefined result means the pair is not
 * in the catalog at all — unreachable for the default preset list, which the catalog produces,
 * and the answer for a caller that passes a list of its own.
 */
function displayNameFill(p: PresetEntry, current: string | undefined): string | undefined {
  if (current?.trim()) return undefined;
  return catalogEntryFor(p.provider, p.model_id)?.displayName;
}

/** A brand-new row for a catalog entry not configured locally (original: null -> added on PUT). */
function presetToRow(p: PresetEntry): RowState {
  const displayName = displayNameFill(p, undefined);
  return {
    provider: p.provider,
    modelId: p.model_id,
    original: null,
    ...presetFields(p),
    // The catalog's name, looked up rather than left for the server to infer: the merged rows
    // are what the page renders and what it submits, so a row that shows a name must carry one.
    // Deliberately outside presetFields, which the catalog owns outright — on an existing row
    // the same lookup is fill-only (see displayNameFill).
    ...(displayName !== undefined ? { displayName } : {}),
    // The output cap and fast mode are user-owned, not catalog-owned (deliberately outside
    // presetFields, so a sync never clobbers them on existing rows): fresh rows inherit the
    // Agent setting / default to off.
    maxTokens: "",
    fastMode: false,
    originalBaseUrl: "",
    apiKeyInput: "",
    clearApiKey: false,
  };
}

/**
 * The saved entry's form of those same fields, straight from the DTO. It mirrors the subset of
 * `models-page.tsx`'s `toRow` the catalog owns — deliberately, so the badge below can read a
 * model table the page has not loaded into row state. `test/catalog-sync.test.ts` pins the two
 * together: whatever `toRow` does to a DTO, this must do to the same DTO, or the badge and the
 * sync button would disagree about whether anything is out of date.
 */
function savedFields(m: ModelDto): CatalogFields {
  return {
    vision: m.vision !== false,
    contextWindow: m.contextWindow !== undefined ? String(m.contextWindow) : "",
    clientType: m.clientType ?? "",
    cacheRead: m.pricing ? String(m.pricing.cacheRead) : "",
    cacheWrite: m.pricing ? String(m.pricing.cacheWrite) : "",
    output: m.pricing ? String(m.pricing.output) : "",
    baseUrl: m.credential?.baseUrl ?? "",
  };
}

/** What syncing would change, and which entries it would touch (see {@link catalogDelta}). */
export interface CatalogDelta {
  added: number;
  updated: number;
  /** `provider/modelId` of every entry that would be added or rewritten, in catalog order. */
  refs: string[];
}

/**
 * What "sync presets" would change if it ran right now, read off a **saved** model table rather
 * than the page's row state — the gate behind the Models nav badge, which has to answer before
 * anyone opens the page.
 *
 * The same union `syncRowsWithCatalog` applies, so the two cannot disagree about whether there
 * is anything to do: catalog entries the table does not carry are additions, entries it does
 * carry whose catalog-owned fields differ — or whose display name is blank — are updates, and
 * locally added models are invisible to both. `refs` is what a dismissal is stamped against, so
 * a later catalog release touching a different model raises the badge again (see
 * `lib/todo-badges.ts`).
 */
export function catalogDelta(
  models: readonly ModelDto[],
  preset: PresetEntry[] = presetModelEntries(),
): CatalogDelta {
  const saved = new Map(models.map((m) => [`${m.provider}\0${m.modelId}`, m]));
  const delta: CatalogDelta = { added: 0, updated: 0, refs: [] };
  for (const p of preset) {
    const entry = saved.get(`${p.provider}\0${p.model_id}`);
    if (entry === undefined) {
      delta.added += 1;
      delta.refs.push(`${p.provider}/${p.model_id}`);
      continue;
    }
    const fields = savedFields(entry);
    const target = presetFields(p);
    // The name counts as an update on the same fill-only rule the merge applies, or a Project
    // carrying rows with no name would hold a badge the button answers "already up to date".
    if (
      displayNameFill(p, entry.displayName) !== undefined ||
      (Object.keys(target) as (keyof CatalogFields)[]).some((k) => fields[k] !== target[k])
    ) {
      delta.updated += 1;
      delta.refs.push(`${p.provider}/${p.model_id}`);
    }
  }
  return delta;
}

/**
 * Merges the current rows with the built-in catalog. Existing rows keep their identity,
 * credential state, and list position (fields are updated in place); catalog-only entries
 * are appended in catalog order. Returns the merged rows plus added/updated counts for the
 * success toast (updated counts only rows the merge actually rewrote).
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
    const fill = displayNameFill(p, row.displayName);
    const changed =
      fill !== undefined ||
      (Object.keys(fields) as (keyof typeof fields)[]).some((k) => row[k] !== fields[k]);
    if (changed) {
      next[i] = { ...row, ...fields, ...(fill !== undefined ? { displayName: fill } : {}) };
      updated += 1;
    }
  }
  return { rows: next, added, updated };
}
