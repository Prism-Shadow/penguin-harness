/**
 * Search and faceted filtering for the hub's list pages, as pure functions over the summaries.
 *
 * - The query matches when every whitespace-separated term appears, case-insensitively, in one of
 *   the item's searchable texts.
 * - A facet maps an item to the values it carries (a category, a time-limit bucket, or none).
 *   Values chosen within one facet widen the result (any of them); facets narrow each other.
 * - A facet's counts are taken over the items that pass the query and every *other* facet, so a
 *   count says what choosing that value would show.
 * - A facet is offered only when it can change the list: two values or more, or one value that
 *   some items lack.
 */

export interface Facet<T> {
  id: string;
  values: (item: T) => readonly string[];
}

export type Selection = Readonly<Record<string, readonly string[]>>;

export function matchesQuery(texts: readonly (string | undefined)[], query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = texts.filter(Boolean).join("\n").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function passesFacets<T>(
  item: T,
  facets: readonly Facet<T>[],
  selection: Selection,
  skip?: string,
): boolean {
  return facets.every((facet) => {
    if (facet.id === skip) return true;
    const chosen = selection[facet.id] ?? [];
    return chosen.length === 0 || facet.values(item).some((value) => chosen.includes(value));
  });
}

export function filterItems<T>(
  items: readonly T[],
  {
    query,
    texts,
    facets,
    selection,
  }: {
    query: string;
    texts: (item: T) => readonly (string | undefined)[];
    facets: readonly Facet<T>[];
    selection: Selection;
  },
): T[] {
  return items.filter(
    (item) => matchesQuery(texts(item), query) && passesFacets(item, facets, selection),
  );
}

/** Each value of `facet` with the number of items choosing it would show, in `order`. */
export function facetCounts<T>(
  items: readonly T[],
  facet: Facet<T>,
  {
    query,
    texts,
    facets,
    selection,
  }: {
    query: string;
    texts: (item: T) => readonly (string | undefined)[];
    facets: readonly Facet<T>[];
    selection: Selection;
  },
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of facet.values(item)) counts.set(value, counts.get(value) ?? 0);
  }
  for (const item of items) {
    if (!matchesQuery(texts(item), query) || !passesFacets(item, facets, selection, facet.id)) {
      continue;
    }
    for (const value of new Set(facet.values(item)))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count }));
}

/** Whether choosing values of `facet` can change the list at all. */
export function facetSplits<T>(items: readonly T[], facet: Facet<T>): boolean {
  const seen = new Set<string>();
  let bare = false;
  for (const item of items) {
    const values = facet.values(item);
    if (values.length === 0) bare = true;
    for (const value of values) seen.add(value);
  }
  return seen.size >= 2 || (seen.size === 1 && bare);
}

/** A selection from URL search params: one comma-separated param per facet id. */
export function readSelection(params: URLSearchParams, facetIds: readonly string[]): Selection {
  return Object.fromEntries(
    facetIds.map((id) => [id, (params.get(id) ?? "").split(",").filter(Boolean)]),
  );
}

/** A benchmark's longest per-task time limit, bucketed; "none" when a task sets no limit. */
export function timeoutBucket(seconds: number | null): "short" | "hour" | "long" | "none" {
  if (seconds === null) return "none";
  if (seconds <= 15 * 60) return "short";
  if (seconds <= 60 * 60) return "hour";
  return "long";
}
