/**
 * One leaderboard: its charts one at a time (the choice is `?chart=` in the URL), with the
 * benchmarks it measures on and the algorithms it compares beside them, each linking to its page.
 */
import { Link, useParams, useSearchParams } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import {
  AuthorName,
  HubDetail,
  HubMissing,
  HubPending,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { ParetoChart } from "../../components/hub/charts/pareto-chart";
import { ScoreTable } from "../../components/hub/charts/score-table";
import { WaffleChart } from "../../components/hub/charts/waffle-chart";
import type { NameOf } from "../../components/hub/charts/entry-name";
import { useDocumentMeta } from "../../lib/document-meta";
import { plugins } from "../../lib/hub/data";
import { formatDay, pick, titleOf } from "../../lib/hub/text";
import type { ChartKind, HubLink, LeaderboardDetail } from "../../lib/hub/types";
import { S } from "../../lib/strings";

const KINDS: ChartKind[] = ["table", "pareto", "waffle"];

export function LeaderboardPage() {
  const { id = "" } = useParams();
  const board = useHubDetail("leaderboard", id);
  if (board === undefined) return <HubPending />;
  if (board === null) return <HubMissing listHref="/leaderboards" />;
  return <LeaderboardView board={board} />;
}

function LinkList({ items, to }: { items: readonly HubLink[]; to: (id: string) => string | null }) {
  const { locale } = useSiteLocale();
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const href = to(item.id);
        return (
          <li key={item.id}>
            {href ? (
              <Link to={href} className="text-brand-700 hover:underline dark:text-brand-300">
                {titleOf(locale, item)}
              </Link>
            ) : (
              titleOf(locale, item)
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LeaderboardView({ board }: { board: LeaderboardDetail }) {
  const { locale } = useSiteLocale();
  const [params, setParams] = useSearchParams();
  const title = titleOf(locale, board);
  useDocumentMeta(S.hub.pageTitle(title), S.hub.leaderboards.description);
  const kinds = KINDS.filter((kind) => board.charts[kind] !== undefined);
  const kind = kinds.find((candidate) => candidate === params.get("chart")) ?? kinds[0];
  const algorithms = new Map(board.algorithms.map((item) => [item.id, item]));
  const libraryPlugins = new Set(plugins.map((plugin) => plugin.id));
  const nameOf: NameOf = (entry) => ({
    method: entry.algorithm
      ? titleOf(locale, algorithms.get(entry.algorithm) ?? { title: entry.algorithm })
      : S.hub.leaderboards.baseline,
    methodHref:
      entry.algorithm && libraryPlugins.has(entry.algorithm)
        ? `/plugins/${entry.algorithm}`
        : undefined,
    model: entry.model,
  });
  const chart = kind ? board.charts[kind] : undefined;
  const subtitle = chart?.subtitle ? pick(locale, chart.subtitle, chart.subtitleZh) : undefined;

  return (
    <HubDetail
      title={title}
      sourceUrl={board.sourceUrl}
      facts={[
        { label: S.hub.meta.author, value: <AuthorName author={board.author} /> },
        { label: S.hub.meta.updated, value: formatDay(board.updated, locale) },
        ...(board.algorithms.length > 0
          ? [
              {
                label: S.hub.leaderboards.algorithms,
                value: (
                  <LinkList
                    items={board.algorithms}
                    to={(id) => (libraryPlugins.has(id) ? `/plugins/${id}` : null)}
                  />
                ),
              },
            ]
          : []),
        {
          label: S.hub.leaderboards.benchmarks,
          value: <LinkList items={board.benchmarks} to={(id) => `/benchmarks/${id}`} />,
        },
      ]}
    >
      <section>
        {kinds.length > 1 && (
          <div
            role="tablist"
            aria-label={S.hub.leaderboards.chartsLabel}
            className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-800"
          >
            {kinds.map((candidate, index) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === kind}
                onClick={() =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current);
                      if (index === 0) next.delete("chart");
                      else next.set("chart", candidate);
                      return next;
                    },
                    { replace: true, preventScrollReset: true },
                  )
                }
                className={`rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
                  candidate === kind
                    ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                }`}
              >
                {S.hub.leaderboards.charts[candidate]}
              </button>
            ))}
          </div>
        )}
        {subtitle && (
          <h2
            className={`text-base font-semibold tracking-tight ${kinds.length > 1 ? "mt-6" : ""}`}
          >
            {subtitle}
          </h2>
        )}
        <div className="mt-4">
          {kind === "table" && board.charts.table && (
            <ScoreTable entries={board.charts.table.entries} nameOf={nameOf} />
          )}
          {kind === "pareto" && board.charts.pareto && (
            <ParetoChart entries={board.charts.pareto.entries} nameOf={nameOf} />
          )}
          {kind === "waffle" && board.charts.waffle && (
            <WaffleChart
              chart={board.charts.waffle}
              nameOf={nameOf}
              taskTitles={board.taskTitles}
            />
          )}
        </div>
      </section>
    </HubDetail>
  );
}
