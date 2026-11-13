/**
 * The list page the Plugins, Benchmarks and Leaderboards pages share: a title with the source the
 * list is read from and, beside it, the search box and the order; facets (a side column from
 * 1024 px, rows above the list below it) and the cards. The query, the facets and the order live
 * in the URL, so a filtered list can be linked and Back restores it.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { SearchIcon, XIcon } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { facetCounts, facetSplits, filterItems, readSelection } from "../../lib/hub/filter";
import type { Facet, Selection } from "../../lib/hub/filter";
import { ExternalLink, ExternalLinkScope } from "../external-link";

export interface HubFacet<T> extends Facet<T> {
  label: string;
  valueLabel: (value: string) => string;
  /** Display order of the values; by default the most common first. */
  order?: readonly string[];
}

export interface HubSort<T> {
  id: string;
  label: string;
  compare: (a: T, b: T) => number;
}

export function HubList<T>({
  title,
  source,
  items,
  keyOf,
  texts,
  facets,
  sorts = [],
  renderItem,
}: {
  title: string;
  source: { href: string; label: string };
  items: readonly T[];
  keyOf: (item: T) => string;
  texts: (item: T) => readonly (string | undefined)[];
  facets: readonly HubFacet<T>[];
  /** The first is the default; one or none shows no control. */
  sorts?: readonly HubSort<T>[];
  renderItem: (item: T) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const offered = useMemo(
    () => facets.filter((facet) => facetSplits(items, facet)),
    [facets, items],
  );
  const selection = readSelection(
    params,
    offered.map((facet) => facet.id),
  );
  const sort = sorts.find((candidate) => candidate.id === params.get("sort")) ?? sorts[0];
  const options = { query, texts, facets: offered, selection };
  const shown = filterItems(items, options);
  if (sort) shown.sort(sort.compare);
  const filtered = query !== "" || offered.some((facet) => (selection[facet.id] ?? []).length > 0);

  const update = (change: (next: URLSearchParams) => void) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  const setQuery = (value: string) =>
    update((next) => (value ? next.set("q", value) : next.delete("q")));
  const toggle = (facet: string, value: string, chosen: Selection) =>
    update((next) => {
      const current = chosen[facet] ?? [];
      const values = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (values.length > 0) next.set(facet, values.join(","));
      else next.delete(facet);
    });
  const clear = () =>
    update((next) => {
      next.delete("q");
      for (const facet of offered) next.delete(facet.id);
    });

  const facetGroups = offered.map((facet) => {
    const counts = facetCounts(items, facet, options);
    const ordered = facet.order
      ? [...counts].sort((a, b) => rank(facet.order!, a.value) - rank(facet.order!, b.value))
      : [...counts].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const chosen = selection[facet.id] ?? [];
    return (
      <div key={facet.id} role="group" aria-label={facet.label}>
        <p className="text-xs text-gray-500 dark:text-gray-400">{facet.label}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 lg:flex-col lg:items-start lg:gap-0.5">
          {ordered.map(({ value, count }) => {
            const on = chosen.includes(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                disabled={count === 0 && !on}
                onClick={() => toggle(facet.id, value, selection)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm whitespace-nowrap transition-colors ${
                  on
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
                    : "text-gray-700 hover:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800 dark:disabled:text-gray-600"
                }`}
              >
                {facet.valueLabel(value)}
                <span className="text-xs text-gray-500 tabular-nums dark:text-gray-400">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <ExternalLinkScope>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {title}
              <span className="ml-2 text-base font-normal text-gray-500 tabular-nums dark:text-gray-400">
                {items.length}
              </span>
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {S.hub.source}{" "}
              <ExternalLink
                href={source.href}
                className="text-gray-900 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500 dark:text-gray-100 dark:decoration-gray-700"
              >
                {source.label}
              </ExternalLink>
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <span className="sr-only">{S.hub.searchPlaceholder}</span>
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={S.hub.searchPlaceholder}
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pr-8 pl-8 text-sm outline-none placeholder:text-gray-400 focus:border-brand-500 dark:border-gray-800 dark:bg-gray-900 dark:focus:border-brand-400 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query !== "" && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={S.hub.clearSearch}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <XIcon aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            {sorts.length > 1 && sort && (
              <div
                role="radiogroup"
                aria-label={S.hub.sortLabel}
                className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-800 dark:bg-gray-900"
              >
                {sorts.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={candidate === sort}
                    onClick={() =>
                      update((next) =>
                        index === 0 ? next.delete("sort") : next.set("sort", candidate.id),
                      )
                    }
                    className={`rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
                      candidate === sort
                        ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    }`}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="mt-8 grid gap-x-8 gap-y-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {offered.length > 0 && <aside className="flex flex-col gap-5">{facetGroups}</aside>}
          <div className={`min-w-0 ${offered.length > 0 ? "" : "lg:col-span-2"}`}>
            {shown.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-600 dark:text-gray-400">
                <p>{S.hub.empty}</p>
                {filtered && (
                  <button
                    type="button"
                    onClick={clear}
                    className="mt-3 text-brand-700 hover:underline dark:text-brand-300"
                  >
                    {S.hub.clearFilters}
                  </button>
                )}
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {shown.map((item) => (
                  <li key={keyOf(item)} className="flex">
                    {renderItem(item)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </ExternalLinkScope>
  );
}

const rank = (order: readonly string[], value: string) => {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
};
