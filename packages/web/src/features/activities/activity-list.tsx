/**
 * The Activities home: every activity of the project grouped by product code, narrowed by a
 * search and by one product tag at a time, sorted by recency or by code.
 */
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ActivityRecord, ActivitySummary } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { ChipGroup } from "../../components/ui/chip-group";
import { EmptyState } from "../../components/ui/empty-state";
import { Input } from "../../components/ui/input";
import { SkeletonList } from "../../components/ui/skeleton";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip } from "../../lib/tone";
import { useLocale } from "../../state/locale";
import { formatRelativeShort } from "../../lib/format";
import { tagCounts } from "./activity-tags";
import {
  groupByProduct,
  readCollapsed,
  writeCollapsed,
  type ActivityGroup,
  type GroupSort,
} from "./activity-groups";
import { runTitle } from "./sessions-panel";

export function ActivityList({
  items,
  loading,
  error,
  editable,
  available,
  createDisabled = false,
  projectId,
  summaries,
  sort,
  onSort,
  search,
  onSearch,
  tag: chosenTag,
  onTag,
  onRefresh,
  onImport,
  onCreate,
  onMedia,
}: {
  items: readonly ActivityRecord[];
  loading: boolean;
  error: string;
  editable: boolean;
  available: boolean;
  /** Creating is held back while something unsaved would be lost by leaving. */
  createDisabled?: boolean;
  projectId: string;
  summaries: Readonly<Record<string, ActivitySummary>>;
  sort: GroupSort;
  onSort: (sort: GroupSort) => void;
  search: string;
  onSearch: (search: string) => void;
  /** The one tag the list is narrowed to, or null for all of them. */
  tag: string | null;
  onTag: (tag: string | null) => void;
  onRefresh: () => void;
  onImport: () => void;
  onCreate: () => void;
  /** Open the project media library: every activity's uploads in one place. */
  onMedia: () => void;
}) {
  const counts = useMemo(() => tagCounts(items), [items]);
  // A tag that no activity carries any more (deleted, or retagged elsewhere) stops filtering.
  const tag =
    chosenTag && counts.some((entry) => entry.tag.toLowerCase() === chosenTag.toLowerCase())
      ? chosenTag
      : null;
  const words = S.activities.tags;
  const home = S.activities.home;
  const groups = useMemo(
    () => groupByProduct(items, summaries, { sort, search, tag }),
    [items, summaries, sort, search, tag],
  );
  const [collapsed, setCollapsed] = useState(() => readCollapsed(projectId));
  function toggle(code: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      writeCollapsed(projectId, next);
      return next;
    });
  }
  const tagValue = counts.find((c) => c.tag.toLowerCase() === tag?.toLowerCase())?.tag ?? "";
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{S.activities.title}</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!available} onClick={onRefresh}>
              {S.activities.refresh}
            </Button>
            <Button size="sm" disabled={!available} onClick={onMedia}>
              {S.activities.projectMedia.open}
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
              <ChipGroup
                label={words.filter}
                value={tagValue}
                onChange={(v) => onTag(v === "" ? null : v)}
                options={[
                  { value: "", label: `${words.all} · ${items.length}` },
                  ...counts.map((c) => ({ value: c.tag, label: `${c.tag} · ${c.count}` })),
                ]}
              />
            )}
            <span className="flex-1" />
            <ChipGroup
              label={home.sortLabel}
              value={sort}
              onChange={onSort}
              options={[
                { value: "recent", label: home.sort.recent },
                { value: "code", label: home.sort.code },
              ]}
            />
          </div>
        )}
        {loading ? (
          <div role="status" aria-label={S.activities.loading}>
            <SkeletonList rows={4} />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState title={items.length === 0 ? S.activities.empty : S.activities.noMatches} />
        ) : (
          groups.map((group) => (
            <ProductGroup
              key={group.productCode}
              group={group}
              summaries={summaries}
              collapsed={collapsed.has(group.productCode)}
              onToggle={() => toggle(group.productCode)}
              editable={editable && available}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ProductGroup({
  group,
  summaries,
  collapsed,
  onToggle,
  editable,
}: {
  group: ActivityGroup;
  summaries: Readonly<Record<string, ActivitySummary>>;
  collapsed: boolean;
  onToggle: () => void;
  editable: boolean;
}) {
  const home = S.activities.home;
  const canonical = group.canonicalId ? summaries[group.canonicalId] : undefined;
  // A new ref copies the canonical ref's media plan, so it waits for one — the same gate as
  // the studio's New ref section (`hasPlan`).
  const canAddRef = editable && !!canonical?.hasPlan;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="border-b border-gray-200 pb-2 dark:border-gray-800">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex w-full items-center gap-2 text-left"
        >
          <Chevron open={!collapsed} />
          <span className="font-mono text-sm font-semibold">{group.productCode}</span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-normal dark:bg-gray-800">
            {group.activityType === "book" ? S.activities.book : S.activities.standard}
          </span>
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
            {home.refs(group.items.length)}
            {group.attention > 0 && ` · ${home.attention(group.attention)}`}
          </span>
        </button>
      </h2>
      {!collapsed && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {group.items.map((item) => (
            <li key={item.id}>
              <ActivityCard item={item} summary={summaries[item.id]} />
            </li>
          ))}
          {editable && (
            <li>
              {canAddRef ? (
                <Link
                  to={`/activities/${group.canonicalId}?section=newRef`}
                  className="flex h-full min-h-24 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                >
                  + {home.newRef}
                </Link>
              ) : (
                <span className="flex h-full min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 p-3 text-center text-sm text-gray-400 dark:border-gray-800">
                  <span>+ {home.newRef}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-500">
                    {home.newRefUnavailable}
                  </span>
                </span>
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** One activity ref as a card linking to it: its title, ref line and milestone progress. */
function ActivityCard({ item, summary }: { item: ActivityRecord; summary?: ActivitySummary }) {
  const home = S.activities.home;
  const { locale } = useLocale();
  return (
    <Link
      to={`/activities/${item.id}`}
      className="flex h-full min-h-24 flex-col gap-1.5 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium">{item.displayName ?? item.title}</span>
        {summary?.canonical && (
          <span className="text-gray-400" aria-label={home.canonical} title={home.canonical}>
            ★
          </span>
        )}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {home.refLine(item.refNum, formatRelativeShort(item.updatedAt, locale))}
      </span>
      {summary && (
        <span className="mt-auto flex items-center justify-between gap-2">
          <span
            className="flex max-w-24 flex-1 gap-0.5"
            role="img"
            aria-label={home.progress(summary.done, summary.total)}
          >
            {Array.from({ length: summary.total }, (_, index) => (
              <i
                key={index}
                className={`h-1 flex-1 rounded-full ${
                  index < summary.done
                    ? "bg-gray-400 dark:bg-gray-500"
                    : "bg-gray-200 dark:bg-gray-800"
                }`}
              />
            ))}
          </span>
          <SummaryStatus status={summary.status} />
        </span>
      )}
    </Link>
  );
}

function SummaryStatus({ status }: { status: ActivitySummary["status"] }) {
  const words = S.activities.home.status;
  const [tone, text] =
    status.kind === "running"
      ? (["busy", words.running(runTitle(status.runKind))] as const)
      : status.kind === "stale"
        ? (["attention", words.stale] as const)
        : status.kind === "built"
          ? (["success", words.built] as const)
          : (["muted", words.next[status.milestone]] as const);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${toneInk[tone]}`}>
      {tone !== "muted" && <span aria-hidden className={`size-1.5 rounded-full ${toneDot[tone]}`} />}
      {text}
    </span>
  );
}
