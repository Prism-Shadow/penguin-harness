/**
 * One leaderboard: a panel with its three views of the same entries, one at a time (the choice is
 * `?chart=` in the URL), then how the numbers are computed and where they come from. The
 * benchmarks it measures on sit in the side column, each linking to its page.
 */
import { Link, useParams, useSearchParams } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import {
  AuthorName,
  HubDetail,
  HubMissing,
  HubPanel,
  HubPending,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { ExternalLink } from "../../components/external-link";
import { MethodNote } from "../../components/hub/charts/method-note";
import { ParetoChart } from "../../components/hub/charts/pareto-chart";
import { ScoreTable } from "../../components/hub/charts/score-table";
import { WaffleChart } from "../../components/hub/charts/waffle-chart";
import type { NameOf } from "../../components/hub/charts/entry-name";
import { useDocumentMeta } from "../../lib/document-meta";
import { plugins } from "../../lib/hub/data";
import { formatDay, titleOf } from "../../lib/hub/text";
import type { ChartKind, LeaderboardDetail, LeaderboardEntry } from "../../lib/hub/types";
import { S } from "../../lib/strings";

const KINDS: ChartKind[] = ["table", "pareto", "waffle"];

export function LeaderboardPage() {
  const { id = "" } = useParams();
  const board = useHubDetail("leaderboard", id);
  if (board === undefined) return <HubPending />;
  if (board === null) return <HubMissing listHref="/leaderboards" />;
  return <LeaderboardView board={board} />;
}

function LeaderboardView({ board }: { board: LeaderboardDetail }) {
  const t = S.hub.leaderboards;
  const { locale } = useSiteLocale();
  const [params, setParams] = useSearchParams();
  const title = titleOf(locale, board);
  useDocumentMeta(S.hub.pageTitle(title), t.description);
  const kind = KINDS.find((candidate) => candidate === params.get("chart")) ?? KINDS[0]!;

  const pluginTitles = new Map(plugins.map((plugin) => [plugin.id, titleOf(locale, plugin)]));
  const methodOf = (entry: LeaderboardEntry) =>
    entry.algorithm ? (pluginTitles.get(entry.algorithm) ?? entry.algorithm) : t.baseline;
  const nameOf: NameOf = (entry) => ({ method: methodOf(entry), model: entry.model });
  const benchmarkTitles = new Map(board.benchmarks.map((item) => [item.id, titleOf(locale, item)]));
  const benchmarkTitle = (id: string) => benchmarkTitles.get(id) ?? id;

  const tabs = (
    <div
      role="tablist"
      aria-label={t.chartsLabel}
      className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-800"
    >
      {KINDS.map((candidate, index) => (
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
          {t.charts[candidate]}
        </button>
      ))}
    </div>
  );

  return (
    <HubDetail
      title={title}
      sourceUrl={board.sourceUrl}
      facts={[
        { label: S.hub.meta.author, value: <AuthorName author={board.author} /> },
        { label: S.hub.meta.updated, value: formatDay(board.updated, locale) },
        { label: t.entries, value: board.entryCount },
      ]}
      aside={
        <HubPanel title={`${t.benchmarks} ${board.benchmarks.length}`} flush>
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {board.benchmarks.map((item) => (
              <li key={item.id} className="px-4 py-2.5">
                <Link
                  to={`/benchmarks/${item.id}`}
                  className="text-brand-700 hover:underline dark:text-brand-300"
                >
                  {titleOf(locale, item)}
                </Link>
              </li>
            ))}
          </ul>
        </HubPanel>
      }
    >
      <HubPanel title={t.results} actions={tabs}>
        {kind === "table" && (
          <ScoreTable entries={board.entries} methodOf={methodOf} benchmarkTitle={benchmarkTitle} />
        )}
        {kind === "pareto" && <ParetoChart entries={board.entries} nameOf={nameOf} />}
        {kind === "waffle" && (
          <WaffleChart
            entries={board.entries}
            grid={board.waffle}
            nameOf={nameOf}
            taskTitles={board.taskTitles}
            benchmarkTitle={benchmarkTitle}
          />
        )}
      </HubPanel>
      <HubPanel title={t.method.title}>
        <MethodNote entries={board.entries} />
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-gray-100 pt-4 text-sm dark:border-gray-800">
          <dt className="text-gray-500 dark:text-gray-400">{t.method.config}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            <ExternalLink
              href={board.sourceUrl}
              className="text-brand-700 hover:underline dark:text-brand-300"
            >
              leaderboard.yaml
            </ExternalLink>
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">{t.method.experiments}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">
            <ExternalLink
              href={board.experimentsUrl}
              className="text-brand-700 hover:underline dark:text-brand-300"
            >
              {board.experimentsUrl
                .replace(/^https:\/\/github\.com\/[^/]+\//, "")
                .replace("/tree/main/", "/")}
            </ExternalLink>
          </dd>
        </dl>
      </HubPanel>
    </HubDetail>
  );
}
