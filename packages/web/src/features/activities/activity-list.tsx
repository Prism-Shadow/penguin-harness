/**
 * The Activities list: every activity of the project as a card, narrowed by a search and by
 * one product tag at a time.
 */
import { useId, useMemo } from "react";
import { Link } from "react-router";
import type { ActivityRecord } from "@prismshadow/penguin-server/api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { filterByTag, tagCounts } from "./activity-tags";
import { activityInitials, filterActivities } from "./preview";
import { recentActivities, type RecentActivity } from "./recent-activities";
import { SEGMENT, SEGMENTS, SEGMENT_OFF, SEGMENT_ON } from "./segment-styles";

export function ActivityList({
  items,
  loading,
  error,
  editable,
  available,
  createDisabled = false,
  recent = [],
  search,
  onSearch,
  tag: chosenTag,
  onTag,
  onRefresh,
  onImport,
  onCreate,
}: {
  items: readonly ActivityRecord[];
  loading: boolean;
  error: string;
  editable: boolean;
  available: boolean;
  /** Creating is held back while something unsaved would be lost by leaving. */
  createDisabled?: boolean;
  /** This project's openings in this browser, most recent first. */
  recent?: readonly RecentActivity[];
  search: string;
  onSearch: (search: string) => void;
  /** The one tag the list is narrowed to, or null for all of them. */
  tag: string | null;
  onTag: (tag: string | null) => void;
  onRefresh: () => void;
  onImport: () => void;
  onCreate: () => void;
}) {
  const counts = useMemo(() => tagCounts(items), [items]);
  // A tag that no activity carries any more (deleted, or retagged elsewhere) stops filtering.
  const tag =
    chosenTag && counts.some((entry) => entry.tag.toLowerCase() === chosenTag.toLowerCase())
      ? chosenTag
      : null;
  const visible = useMemo(
    () => filterActivities(filterByTag(items, tag), search),
    [items, tag, search],
  );
  const recentItems = useMemo(() => recentActivities(items, recent), [items, recent]);
  // Searching is looking for something else, so the row steps aside for the matches.
  const showRecent = !loading && search.trim() === "" && recentItems.length > 0;
  const recentId = useId();
  const allId = useId();
  const words = S.activities.tags;
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{S.activities.title}</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!available} onClick={onRefresh}>
              {S.activities.refresh}
            </Button>
            {editable && (
              <Button size="sm" disabled={!available} onClick={onImport}>
                {S.activities.importFromLoom}
              </Button>
            )}
            {editable && (
              <Button
                size="sm"
                variant="primary"
                disabled={!available || createDisabled}
                onClick={onCreate}
              >
                {S.activities.newActivity}
              </Button>
            )}
          </div>
        </header>
        {!available && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.unavailable}
          </p>
        )}
        {available && !editable && (
          <p className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.readOnly}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Input
              size="sm"
              aria-label={S.activities.search}
              placeholder={S.activities.search}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              className="max-w-sm"
            />
            {counts.length > 0 && (
              <div role="group" aria-label={words.filter} className={SEGMENTS}>
                {[null, ...counts].map((entry) => {
                  const value = entry?.tag ?? null;
                  const on =
                    value === null ? tag === null : tag?.toLowerCase() === value.toLowerCase();
                  return (
                    <button
                      key={value ?? ""}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onTag(value)}
                      className={`${SEGMENT} ${on ? SEGMENT_ON : SEGMENT_OFF}`}
                    >
                      {entry ? `${entry.tag} · ${entry.count}` : `${words.all} · ${items.length}`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {showRecent && (
          <section aria-labelledby={recentId} className="space-y-3">
            <h2 id={recentId} className="text-sm font-semibold">
              {S.activities.recent.title}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recentItems.map((item) => (
                <li key={item.id}>
                  <ActivityCard item={item} compact />
                </li>
              ))}
            </ul>
          </section>
        )}
        {loading ? (
          <p role="status" className="text-xs text-gray-500">
            {S.activities.loading}
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500">
            {items.length === 0 ? S.activities.empty : S.activities.noMatches}
          </p>
        ) : (
          <section
            // Named even without its heading, so the full list is one region to look in.
            aria-labelledby={showRecent ? allId : undefined}
            aria-label={showRecent ? undefined : S.activities.recent.all}
            className="space-y-3"
          >
            {showRecent && (
              <h2 id={allId} className="text-sm font-semibold">
                {S.activities.recent.all}
              </h2>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((item) => (
                <li key={item.id}>
                  <ActivityCard item={item} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** One activity as a card linking to it; compact leaves out its type and tags. */
function ActivityCard({ item, compact = false }: { item: ActivityRecord; compact?: boolean }) {
  return (
    <Link
      to={`/activities/${item.id}`}
      className="flex h-full flex-col gap-2 rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {activityInitials(item.title, item.productCode)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          <span className="block truncate text-xs text-gray-500">
            {item.productCode} / {item.refNum}
          </span>
        </span>
      </span>
      {!compact && (
        <span className="mt-auto flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
            {item.activityType === "book" ? S.activities.book : S.activities.standard}
          </span>
          {(item.tags ?? []).map((entry) => (
            <Badge key={entry} tone="gray">
              {entry}
            </Badge>
          ))}
        </span>
      )}
    </Link>
  );
}
