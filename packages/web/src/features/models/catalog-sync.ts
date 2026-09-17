/**
 * One-click sync of the Project model table with the built-in catalog ("sync presets" next
 * to the search box): union semantics — catalog entries not configured locally are added;
 * entries present on both sides are reset to the catalog's fields (context window, pricing,
 * protocol, base URL, vision, and the promotion — the catalog wins wherever the two differ).
 * Missing catalog pricing removes local pricing, and a missing catalog promotion removes the
 * stored one. Locally added models (including user-defined groups) are kept untouched. A retired
 * catalog entry (see `ModelCatalogEntry.retired`) is never added, but one configured locally is
 * reset like any other preset, which is what keeps its stored price on the catalog's.
 * Credentials are never touched: merged rows carry no apiKey input (the PUT keeps the stored
 * key) and existing rows keep their credential display state.
 *
 * The price a sync writes is the catalog's list price; the promotion running on it is stored by
 * the server outside the config file, which is why it travels as a declaration rather than as a
 * field — see {@link catalogPromotion}, which also covers the Penguin Go group it leaves alone.
 * The display name is the one catalog field that is filled but never overwritten — see
 * {@link displayNameFill}.
 */
import {
  PENGUIN_GO_PROVIDER_ID,
  catalogEntryFor,
  catalogModelEntries,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import { fractionOff } from "./model-grouping";
import type { RowState } from "./models-page";

type PresetEntry = ReturnType<typeof catalogModelEntries>[number];

/** One saved model entry, as the models endpoint sends it. */
type ModelDto = ModelsResponse["models"][number];

/** The catalog-owned fields, in the string-typed form both sides are compared in. */
type CatalogFields = ReturnType<typeof presetFields>;

/** The catalog-owned fields of a row, in RowState's string-typed form (mirrors toRow). */
function presetFields(p: PresetEntry) {
  const pricing = p.pricing
    ? {
        cacheRead: String(p.pricing.cache_read),
        cacheWrite: String(p.pricing.cache_write),
        output: String(p.pricing.output),
      }
    : undefined;
  return {
    vision: p.vision !== false,
    contextWindow: p.context_window !== undefined ? String(p.context_window) : "",
    clientType: p.client_type ?? "",
    cacheRead: pricing?.cacheRead ?? "",
    cacheWrite: pricing?.cacheWrite ?? "",
    output: pricing?.output ?? "",
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
 * The name comes from the catalog rather than from `p`: `catalogModelEntries` emits the
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

/** A promotion as the catalog declares it for one row: `undefined` is "none". */
type CatalogPromotion = { discount: number | undefined };

/**
 * The promotion a sync declares for a preset row, or `null` for a row whose promotion is not the
 * catalog's to declare.
 *
 * The catalog owns it on the same terms as the price it runs on: its flat `discount` when that
 * is a fraction in (0, 1), and no promotion otherwise (`discount: undefined`, sent as `null` so
 * a promotion that has ended is cleared). Like the display name it is looked up in the catalog,
 * because the persisted entry shape carries no promotion.
 *
 * Merged rows declare it whether or not anything about them changed. A row whose price the merge
 * rewrites has to: the server keeps a stored promotion only through saves that leave the row's
 * price alone. On every other row it restates the catalog's value, so what the save stores
 * follows the catalog rather than whatever promotion the page last loaded.
 *
 * Penguin Go rows get `null`: that group's promotions arrive with the platform's own catalog, on
 * authorization and on the group's Sync, so this sync never compares them and never changes
 * them. A merge that rewrites such a row's price still has to restate the promotion it already
 * has, or the server would drop it along with the old price (see syncRowsWithCatalog).
 */
function catalogPromotion(p: PresetEntry): CatalogPromotion | null {
  if (p.provider === PENGUIN_GO_PROVIDER_ID) return null;
  return { discount: fractionOff(catalogEntryFor(p.provider, p.model_id)?.discount) };
}

/** Whether `current` differs from the catalog's promotion (never, on a row it is not the catalog's). */
function promotionDiffers(
  promotion: CatalogPromotion | null,
  current: number | undefined,
): boolean {
  return promotion !== null && current !== promotion.discount;
}

/** The fields that make a row declare `promotion` on save (see rowToEntry). */
function declared(promotion: CatalogPromotion): Pick<RowState, "discount" | "discountDeclared"> {
  return { discount: promotion.discount, discountDeclared: true };
}

/**
 * Whether the catalog keeps `p` only for the Projects that already carry it (see
 * `ModelCatalogEntry.retired`): a sync updates such an entry where it is configured and never adds
 * it where it is not. Looked up in the catalog, like the name and the promotion.
 */
function isRetired(p: PresetEntry): boolean {
  return catalogEntryFor(p.provider, p.model_id)?.retired === true;
}

/** A brand-new row for a catalog entry not configured locally (original: null -> added on PUT). */
function presetToRow(p: PresetEntry): RowState {
  const displayName = displayNameFill(p, undefined);
  const promotion = catalogPromotion(p);
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
    ...(promotion !== null ? declared(promotion) : {}),
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
 * sync button would disagree about whether anything is out of date. The promotion is the one
 * catalog-owned value compared outside these fields, and both sides read it verbatim: `toRow`
 * copies `discount` straight off the DTO.
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
 * is anything to do: catalog entries the table does not carry are additions (retired ones
 * never are), entries it does carry whose catalog-owned fields differ — a promotion-only
 * difference included, outside the Penguin Go group — or whose display name is blank are
 * updates, and locally added models are invisible to both. `refs` is what a dismissal is stamped
 * against, so a later catalog release touching a different model raises the badge again (see
 * `lib/todo-badges.ts`).
 */
export function catalogDelta(
  models: readonly ModelDto[],
  preset: PresetEntry[] = catalogModelEntries(),
): CatalogDelta {
  const saved = new Map(models.map((m) => [`${m.provider}\0${m.modelId}`, m]));
  const delta: CatalogDelta = { added: 0, updated: 0, refs: [] };
  for (const p of preset) {
    const entry = saved.get(`${p.provider}\0${p.model_id}`);
    if (entry === undefined) {
      if (isRetired(p)) continue;
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
      promotionDiffers(catalogPromotion(p), entry.discount) ||
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
 * other than retired ones are appended in catalog order. Returns the merged rows plus
 * added/updated counts for the success toast (updated counts only rows the merge actually
 * rewrote).
 *
 * Every preset row outside the Penguin Go group leaves the merge declaring its catalog
 * promotion, rewritten or not (see catalogPromotion), so such a row is a new object even when
 * nothing about it changed: `updated` is the count of changes, not object identity. A Penguin Go
 * row the merge rewrites declares the promotion it already has.
 */
export function syncRowsWithCatalog(
  rows: RowState[],
  preset: PresetEntry[] = catalogModelEntries(),
): { rows: RowState[]; added: number; updated: number } {
  const key = (provider: string, modelId: string) => `${provider}\0${modelId}`;
  const index = new Map(rows.map((r, i) => [key(r.provider, r.modelId), i]));
  const next = [...rows];
  let added = 0;
  let updated = 0;
  for (const p of preset) {
    const i = index.get(key(p.provider, p.model_id));
    if (i === undefined) {
      if (isRetired(p)) continue;
      next.push(presetToRow(p));
      added += 1;
      continue;
    }
    const row = next[i]!;
    const fields = presetFields(p);
    const fill = displayNameFill(p, row.displayName);
    const promotion = catalogPromotion(p);
    const changed =
      fill !== undefined ||
      promotionDiffers(promotion, row.discount) ||
      (Object.keys(fields) as (keyof typeof fields)[]).some((k) => row[k] !== fields[k]);
    if (changed) updated += 1;
    if (changed || promotion !== null) {
      next[i] = {
        ...row,
        ...fields,
        ...(fill !== undefined ? { displayName: fill } : {}),
        // Only a rewritten row reaches here without a catalog promotion: a Penguin Go row,
        // which keeps the platform's promotion it already has.
        ...(promotion !== null
          ? declared(promotion)
          : { discount: row.discount, discountDeclared: true }),
      };
    }
  }
  return { rows: next, added, updated };
}
