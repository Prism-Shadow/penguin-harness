/**
 * The order of the models INSIDE each group on the models page (pure decisions, unit tested), and
 * where each group's choice is kept. The order of the groups themselves is model-group-order.ts's
 * business and is never touched here.
 *
 * Each group has one sort, picked from its header's gear menu:
 *
 * - **Price, low to high** (the default) and **high to low** compare one blended figure per row,
 *   `(cache write × 3 + output) ÷ 4` per million Tokens: three parts input to one part output.
 *   The buckets are the ones the card prints, the rate billed right now (billedPrice: the list
 *   price less a running promotion, and less a live off-peak tier), so a promotion or an off-peak
 *   hour moves a row exactly as far as it moves the figure on its card. The page re-sorts on the
 *   hour, when a tier can start or end. Prices are stored in USD whatever the vendor's currency,
 *   so CNY rows compare with the rest as they are. A free row is 0 and leads the low-to-high
 *   order; a row with no price has nothing to compare and ends the list in BOTH directions.
 *   Equal prices fall back to the name.
 * - **Name** orders by what the card shows (the display name, else the model id), with the UI
 *   language's collation: case and accents ignored, digit runs read as numbers, so `GLM-5.2`
 *   comes before `GLM-5.10`.
 *
 * The choice is a view preference of this browser, like the group pins (model-group-pins.ts): one
 * global key, by group id, holding only the groups whose sort differs from the default. A
 * user-defined group is remembered by its name, so the choice follows that name into any
 * Project with such a group. Storage is injectable (vitest runs in Node, no localStorage);
 * nothing stored, unrecognized values and throwing storage all read as the default.
 */
import { billedPrice } from "./model-grouping";
import type { ModelRowLike, PricingBucketsLike, ProviderGroup } from "./model-grouping";

/** How one group orders its models. */
export type ModelGroupSort = "price-asc" | "price-desc" | "name";

/** Every sort, in the order the gear menu offers them. */
export const MODEL_GROUP_SORTS: readonly ModelGroupSort[] = ["price-asc", "price-desc", "name"];

/** Every group starts here, and choosing it again is how a group goes back. */
export const DEFAULT_MODEL_GROUP_SORT: ModelGroupSort = "price-asc";

/**
 * One row's blended price at `now`, in USD per million Tokens, from the buckets its card prints;
 * undefined for a row with no price.
 */
export function blendedPrice(
  row: ModelRowLike & PricingBucketsLike,
  now: Date = new Date(),
): number | undefined {
  const billed = billedPrice(row, now);
  return billed === undefined ? undefined : (billed.cacheWrite * 3 + billed.output) / 4;
}

/** What a row is called on its card: its display name, or its model id when it has none. */
const rowName = (row: ModelRowLike): string => row.displayName?.trim() || row.modelId;

/**
 * One group's rows in the order `sort` puts them. A new array: the input is left as it was.
 * `locale` is the UI language (a BCP 47 tag), which only the name comparison reads.
 */
export function sortGroupRows<T extends ModelRowLike & PricingBucketsLike>(
  rows: readonly T[],
  sort: ModelGroupSort,
  now: Date,
  locale: string,
): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const byName = (a: T, b: T): number => collator.compare(rowName(a), rowName(b));
  if (sort === "name") return [...rows].sort(byName);
  const direction = sort === "price-desc" ? -1 : 1;
  return rows
    .map((row) => ({ row, price: blendedPrice(row, now) }))
    .sort((a, b) => {
      if (a.price === undefined || b.price === undefined) {
        if (a.price !== b.price) return a.price === undefined ? 1 : -1;
        return byName(a.row, b.row);
      }
      return (a.price - b.price) * direction || byName(a.row, b.row);
    })
    .map(({ row }) => row);
}

/** The sorts users chose, by group id: only those that differ from the default. */
export type ModelGroupSorts = Readonly<Record<string, ModelGroupSort>>;

/**
 * A group's sort. Own keys only: a user-defined group may be called `constructor`, which every
 * plain object answers through its prototype.
 */
export function modelGroupSortOf(sorts: ModelGroupSorts, id: string): ModelGroupSort {
  return Object.hasOwn(sorts, id) ? sorts[id]! : DEFAULT_MODEL_GROUP_SORT;
}

/**
 * `sorts` with one group's choice. The default is removed rather than stored; a choice that
 * changes nothing returns `sorts` itself, and the page skips the write on that identity.
 */
export function withModelGroupSort(
  sorts: ModelGroupSorts,
  id: string,
  sort: ModelGroupSort,
): ModelGroupSorts {
  if (modelGroupSortOf(sorts, id) === sort) return sorts;
  if (sort !== DEFAULT_MODEL_GROUP_SORT) return { ...sorts, [id]: sort };
  const next: Record<string, ModelGroupSort> = { ...sorts };
  delete next[id];
  return next;
}

/**
 * The page's groups with each one's rows in that group's sort. The groups keep the order they
 * came in, and a search's matches are sorted the same way the whole group would be.
 */
export function sortModelGroups<T extends ModelRowLike & PricingBucketsLike>(
  groups: readonly ProviderGroup<T>[],
  sorts: ModelGroupSorts,
  now: Date,
  locale: string,
): ProviderGroup<T>[] {
  return groups.map((group) => ({
    ...group,
    rows: sortGroupRows(group.rows, modelGroupSortOf(sorts, group.provider.id), now, locale),
  }));
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface ModelGroupSortStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The sorts' single global key; holds ModelGroupSorts as a JSON object. */
export const MODEL_GROUP_SORTS_KEY = "penguin.modelsGroupSort";

const isSort = (value: unknown): value is ModelGroupSort =>
  MODEL_GROUP_SORTS.includes(value as ModelGroupSort);

/**
 * Reads the stored sorts. Only a known sort under a non-empty group id is kept; anything else —
 * absent, unparseable, not an object, throwing storage — reads as no choices, i.e. every group
 * on the default. `localStorage` is resolved inside the try: merely touching it throws where
 * site data is blocked, and this runs from a useState initializer.
 */
export function initialModelGroupSorts(storage?: ModelGroupSortStorage): ModelGroupSorts {
  try {
    const raw = (storage ?? localStorage).getItem(MODEL_GROUP_SORTS_KEY);
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // fromEntries defines own properties, so no stored id can reach the object's prototype.
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([id, sort]) => id !== "" && isSort(sort) && sort !== DEFAULT_MODEL_GROUP_SORT,
      ),
    );
  } catch {
    return {};
  }
}

/** Writes the sorts on every change (best-effort: quota limits / private browsing fail silently). */
export function storeModelGroupSorts(
  sorts: ModelGroupSorts,
  storage?: ModelGroupSortStorage,
): void {
  try {
    (storage ?? localStorage).setItem(MODEL_GROUP_SORTS_KEY, JSON.stringify(sorts));
  } catch {
    /* best-effort persistence */
  }
}
